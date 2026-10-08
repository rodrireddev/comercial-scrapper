// Funciones que se ejecutan DENTRO de la página de Google Maps (vía webContents.executeJavaScript).
// Se serializan con Function.prototype.toString(), así que deben ser autocontenidas:
// no pueden usar imports ni nada definido fuera de su propio cuerpo.
//
// Los selectores de Google Maps cambian con el tiempo; por eso cada dato se busca con varias
// alternativas (clases conocidas, atributos data-item-id y aria-label).

export interface ResultLink {
  url: string;
  name: string;
}

export interface ExtractedPlace {
  name?: string;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  status?: 'operational' | 'closed_temporarily' | 'closed_permanently';
  recentlyOpened: boolean;
  /** Se pudo ordenar por "más recientes" (sin sesión iniciada Google muestra una vista limitada). */
  reviewsSortedByNewest: boolean;
  reviews: Array<{ id?: string; author?: string; rating?: number; text?: string; relativeDate?: string }>;
}

export interface ResultsPage {
  links: ResultLink[];
  /** Google cortó la lista pidiendo iniciar sesión (vista limitada, ~8 resultados). */
  limited: boolean;
}

export async function collectResults(max: number): Promise<ResultsPage | { blocked: string }> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async <T>(fn: () => T | null | undefined, timeout: number): Promise<T | undefined> => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(250);
    }
    return undefined;
  };

  if (/unusual traffic|tráfico inusual|captcha/i.test(document.body?.innerText ?? '')) {
    return { blocked: 'Google detectó tráfico inusual (captcha). Aumentá la pausa entre páginas o usá la Places API.' };
  }

  await waitFor(() => document.querySelector('div[role="feed"]') ?? document.querySelector('h1.DUwDvf'), 20000);
  const feed = document.querySelector<HTMLElement>('div[role="feed"]');

  // Búsquedas con un único resultado redirigen directamente a la ficha del lugar.
  if (!feed) {
    if (location.href.includes('/maps/place/')) {
      return { links: [{ url: location.href, name: document.querySelector('h1')?.textContent?.trim() ?? '' }], limited: false };
    }
    return { links: [], limited: false };
  }

  const links = () => Array.from(feed.querySelectorAll<HTMLAnchorElement>('a[href*="/maps/place/"]'));
  let lastCount = -1;
  let stale = 0;
  while (links().length < max && stale < 6) {
    const tail = feed.lastElementChild?.textContent ?? '';
    if (/llegaste al final|reached the end|no hay más resultados|no more results/i.test(tail)) break;
    feed.scrollTop = feed.scrollHeight;
    await sleep(1300);
    const count = links().length;
    stale = count === lastCount ? stale + 1 : 0;
    lastCount = count;
  }

  const seen = new Set<string>();
  const out: ResultLink[] = [];
  for (const a of links()) {
    const key = a.href.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: a.href, name: a.getAttribute('aria-label') ?? a.textContent?.trim() ?? '' });
    if (out.length >= max) break;
  }
  const tailText = feed.lastElementChild?.textContent ?? '';
  const limited = out.length < max && /iniciar sesi[oó]n|sign in/i.test(tailText);
  return { links: out, limited };
}

export async function extractPlace(opts: { fetchReviews: boolean; maxReviews: number }): Promise<ExtractedPlace | { blocked: string }> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async <T>(fn: () => T | null | undefined, timeout: number): Promise<T | undefined> => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(250);
    }
    return undefined;
  };
  const txt = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
  const parseDecimal = (s: string | undefined) => {
    const m = s?.match(/\d+(?:[.,]\d+)?/);
    return m ? Number(m[0].replace(',', '.')) : undefined;
  };
  const parseInteger = (s: string | undefined) => {
    const m = s?.match(/\d[\d.,\s]*/);
    return m ? Number(m[0].replace(/[.,\s]/g, '')) : undefined;
  };

  if (/unusual traffic|tráfico inusual|captcha/i.test(document.body?.innerText ?? '')) {
    return { blocked: 'Google detectó tráfico inusual (captcha).' };
  }

  await waitFor(() => document.querySelector('h1.DUwDvf') ?? document.querySelector('div[role="main"] h1'), 20000);
  await sleep(600);
  const main = document.querySelector<HTMLElement>('div[role="main"]') ?? document.body;

  const name = txt(main.querySelector('h1.DUwDvf')) ?? txt(main.querySelector('h1'));
  const category = txt(main.querySelector('button.DkEaL')) ?? txt(main.querySelector('button[jsaction*="category"]'));

  // Calificación y cantidad de reseñas.
  let rating: number | undefined;
  let reviewCount: number | undefined;
  const f7 = main.querySelector('div.F7nice');
  if (f7) {
    rating = parseDecimal(txt(f7.querySelector('span[aria-hidden="true"]')));
    const countEl = Array.from(f7.querySelectorAll('span[aria-label]')).find((s) =>
      /rese|opini|review/i.test(s.getAttribute('aria-label') ?? ''),
    );
    reviewCount = parseInteger(countEl?.getAttribute('aria-label') ?? undefined) ?? parseInteger(txt(f7)?.match(/\(([\d.,\s]+)\)/)?.[1]);
  }
  if (rating === undefined) {
    const el = main.querySelector('[aria-label*="estrellas"], [aria-label*="stars"]');
    rating = parseDecimal(el?.getAttribute('aria-label') ?? undefined);
  }
  if (reviewCount === undefined) {
    const el = Array.from(main.querySelectorAll('[aria-label]')).find((e) =>
      /^[\d.,\s]+\s*(reseñas|opiniones|reviews)/i.test(e.getAttribute('aria-label') ?? ''),
    );
    reviewCount = parseInteger(el?.getAttribute('aria-label') ?? undefined);
  }

  const addressEl = main.querySelector('button[data-item-id="address"]');
  const address = txt(addressEl?.querySelector('.Io6YTe')) ?? addressEl?.getAttribute('aria-label')?.replace(/^(Dirección|Address):\s*/i, '');
  const website = main.querySelector<HTMLAnchorElement>('a[data-item-id="authority"]')?.href;
  const phoneEl = main.querySelector('button[data-item-id^="phone:tel:"]');
  const phone = txt(phoneEl?.querySelector('.Io6YTe')) ?? phoneEl?.getAttribute('data-item-id')?.replace('phone:tel:', '');

  const mainText = main.innerText ?? '';
  const status = /cerrado permanentemente|permanently closed/i.test(mainText)
    ? 'closed_permanently'
    : /cerrado temporalmente|temporarily closed/i.test(mainText)
      ? 'closed_temporarily'
      : 'operational';
  const recentlyOpened = /inaugurado recientemente|reci[eé]n inaugurado|recently opened|abri[oó] recientemente|nueva apertura|new opening/i.test(mainText);

  const reviews: ExtractedPlace['reviews'] = [];
  let reviewsSortedByNewest = false;
  if (opts.fetchReviews && (reviewCount ?? 1) > 0) {
    const tab = Array.from(main.querySelectorAll<HTMLElement>('button[role="tab"]')).find((b) =>
      /opiniones|reseñas|reviews/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
    );
    if (tab) {
      tab.click();
      // La vista general también contiene reseñas y un botón "Ordenar": esperar a que la pestaña quede activa
      // y la vista general se desmonte antes de tocar nada.
      await waitFor(() => (tab.getAttribute('aria-selected') === 'true' ? tab : undefined), 5000);
      await sleep(1000);

      const sortSelector =
        'button[aria-label*="Ordenar"], button[aria-label*="Sort"], button[data-value="Ordenar"], button[data-value="Sort"]';
      const sortBtn = await waitFor(() => document.querySelector<HTMLElement>(sortSelector), 6000);

      // Ordenar por "Más recientes" para medir actividad.
      if (sortBtn) {
        sortBtn.click();
        const newest = await waitFor(
          () =>
            Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')).find((i) =>
              /reciente|newest|recent/i.test(i.textContent ?? ''),
            ),
          4000,
        );
        if (newest) {
          newest.click();
          reviewsSortedByNewest = true;
          await sleep(1500);
        } else {
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
      }

      // La lista se carga de forma diferida al hacer scroll en el panel lateral.
      const findScroller = () =>
        Array.from(document.querySelectorAll<HTMLElement>('div[role="main"] div')).find(
          (d) => d.scrollHeight > d.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(d).overflowY),
        );
      const scroller = await waitFor(findScroller, 5000);
      const reviewEls = () =>
        Array.from(document.querySelectorAll<HTMLElement>('div.jftiEf[data-review-id], div[data-review-id][aria-label]'));
      let stale = 0;
      let last = -1;
      for (let i = 0; scroller && i < 30 && reviewEls().length < opts.maxReviews && stale < 4; i++) {
        scroller.scrollTop = scroller.scrollHeight;
        await sleep(1000);
        const n = reviewEls().length;
        stale = n === last ? stale + 1 : 0;
        last = n;
      }

      // Expandir textos truncados ("Más").
      document.querySelectorAll<HTMLElement>('button.w8nwRe').forEach((b) => b.click());
      await sleep(300);

      const seen = new Set<string>();
      for (const el of reviewEls()) {
        const id = el.getAttribute('data-review-id') ?? undefined;
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        const starsEl = el.querySelector('span.kvMYJc, span[role="img"][aria-label*="estrella"], span[role="img"][aria-label*="star"]');
        reviews.push({
          id,
          author: txt(el.querySelector('.d4r55')) ?? el.getAttribute('aria-label') ?? undefined,
          rating: parseDecimal(starsEl?.getAttribute('aria-label') ?? undefined) ?? parseDecimal(txt(el.querySelector('.fzvQIb'))),
          relativeDate: txt(el.querySelector('span.rsqaWe')) ?? txt(el.querySelector('.xRkPPb')),
          text: txt(el.querySelector('span.wiI7pd')),
        });
        if (reviews.length >= opts.maxReviews) break;
      }
    }
  }

  return { name, category, address, phone, website, rating, reviewCount, status, recentlyOpened, reviewsSortedByNewest, reviews };
}
