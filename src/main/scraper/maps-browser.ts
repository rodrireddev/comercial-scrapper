import { app, BrowserWindow, session } from 'electron';
import type { GeocodeResult, MapsSessionStatus, RawPlace } from '../../shared/types';
import { parseRelativeDate } from '../dates';
import { radiusToZoom, type SearchCell } from '../../shared/grid';
import { collectResults, extractPlace, type ExtractedPlace, type ResultsPage } from './page-scripts';
import { abortable, politeDelay, sleep, throwIfAborted, type PlaceProvider, type PlaceRef, type ProviderContext } from './provider';

// Proveedor que navega Google Maps en una ventana de Electron y lee el DOM.
// No requiere API key, pero es frágil ante cambios de la página y puede chocar con los términos
// de uso de Google: usar con pausas razonables y volumen moderado.

const PARTITION = 'persist:gmaps';
const MAX_REVIEWS = 20;

function serialize<A>(fn: (arg: A) => unknown, arg: A): string {
  return `(${fn.toString()})(${JSON.stringify(arg)})`;
}

function placeIdFromUrl(url: string): string | undefined {
  const feature = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1];
  if (feature) return `maps:${feature}`;
  const cid = url.match(/!19s(ChIJ[^!?/]+)/)?.[1];
  return cid ? `maps:${cid}` : undefined;
}

function locationFromUrl(url: string): { lat: number; lng: number } | undefined {
  const m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : undefined;
}

let sessionReady = false;

/** Sesión persistente y aislada del scraper (cookies de Google separadas de la app). */
function mapsSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION);
  if (sessionReady) return ses;
  sessionReady = true;
  // User-Agent de Chrome normal: con "Electron" en el UA Google sirve una versión degradada.
  ses.setUserAgent(app.userAgentFallback.replace(/\s(Electron|comercial-scrapper)\/\S+/g, ''));
  // En ventanas ocultas no hace falta descargar imágenes ni teselas del mapa.
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    const hidden = details.webContents && !BrowserWindow.fromWebContents(details.webContents)?.isVisible();
    cb({ cancel: !!hidden && (details.resourceType === 'image' || details.resourceType === 'media') });
  });
  return ses;
}

/** Hay sesión de Google si existe la cookie SID en la partición del scraper. */
export async function getMapsSessionStatus(): Promise<MapsSessionStatus> {
  const cookies = await mapsSession().cookies.get({ name: 'SID' });
  return { loggedIn: cookies.some((c) => c.domain?.endsWith('google.com')) };
}

/** Borra cookies y datos de la sesión del scraper (cierra la sesión de Google solo en esta app). */
export async function logoutMaps(): Promise<void> {
  await mapsSession().clearStorageData();
}

let loginWindow: BrowserWindow | undefined;

/**
 * Abre Google visible en la sesión del scraper para que el usuario inicie sesión con su cuenta.
 * Sin sesión, Google muestra una vista limitada: pocas reseñas y sin poder ordenarlas por fecha.
 * `onClosed` se llama al cerrar la ventana, para refrescar el estado de la sesión.
 */
export function openMapsLoginWindow(onClosed: () => void): void {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }
  mapsSession();
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Iniciar sesión en Google (scraper) — cerrá esta ventana al terminar',
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  loginWindow = win;
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    loginWindow = undefined;
    onClosed();
  });
  // Al volver a Maps tras iniciar sesión se cierra sola.
  win.webContents.on('did-navigate', (_e, url) => {
    if (url.startsWith('https://www.google.com/maps')) {
      void getMapsSessionStatus().then((st) => {
        if (st.loggedIn && !win.isDestroyed()) win.close();
      });
    }
  });
  void win.loadURL('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.google.com%2Fmaps%3Fhl%3Des');
}

/**
 * Geocodifica con Google Maps: busca el texto en una ventana oculta y lee el centro y zoom de la URL
 * resultante. El área aproximada se calcula a partir del zoom y el tamaño de la ventana.
 */
export async function geocodeWithMaps(query: string): Promise<GeocodeResult | undefined> {
  mapsSession();
  const width = 1280;
  const height = 900;
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  try {
    try {
      await win.loadURL(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=es`);
    } catch {
      /* redirecciones internas */
    }
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const m = win.webContents.getURL().match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?)z/);
      if (m) {
        const center = { lat: Number(m[1]), lng: Number(m[2]) };
        const zoom = Number(m[3]);
        const mPerPx = (156_543.03392 * Math.cos((center.lat * Math.PI) / 180)) / 2 ** zoom;
        // Se toma la mitad del viewport para no abarcar de más.
        const halfH = ((height / 4) * mPerPx) / 110_574;
        const halfW = ((width / 4) * mPerPx) / (111_320 * Math.cos((center.lat * Math.PI) / 180));
        return {
          label: query,
          center,
          bounds: { south: center.lat - halfH, north: center.lat + halfH, west: center.lng - halfW, east: center.lng + halfW },
        };
      }
      await sleep(400);
    }
    return undefined;
  } finally {
    win.destroy();
  }
}

export class MapsBrowserProvider implements PlaceProvider {
  private win: BrowserWindow | undefined;
  private warnedLimited = false;

  private window(ctx: ProviderContext): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    mapsSession();

    this.win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: ctx.settings.showBrowser,
      title: 'Google Maps — scraper',
      paintWhenInitiallyHidden: true,
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.win.setMenuBarVisibility(false);
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return this.win;
  }

  private async load(url: string, ctx: ProviderContext): Promise<BrowserWindow> {
    const win = this.window(ctx);
    try {
      await abortable(win.loadURL(url), ctx.signal);
    } catch (err) {
      throwIfAborted(ctx.signal);
      // Maps redirige internamente y loadURL puede rechazar con ERR_ABORTED; la página igual carga.
      void err;
    }
    await this.handleConsent(win, ctx);
    return win;
  }

  /** Si Google muestra la pantalla de cookies, se muestra la ventana para que el usuario decida. */
  private async handleConsent(win: BrowserWindow, ctx: ProviderContext): Promise<void> {
    if (!win.webContents.getURL().includes('consent.google.')) return;
    win.show();
    win.focus();
    ctx.waitingUser('Google pide aceptar o rechazar cookies. Elegí una opción en la ventana de Google Maps para continuar.');
    const deadline = Date.now() + 5 * 60_000;
    while (win.webContents.getURL().includes('consent.google.')) {
      if (Date.now() > deadline) throw new Error('Tiempo de espera agotado en la pantalla de cookies de Google.');
      await sleep(1000, ctx.signal);
    }
    if (!ctx.settings.showBrowser) win.hide();
    ctx.log('Pantalla de cookies resuelta, continuando…');
    await sleep(2000, ctx.signal);
  }

  async search(cell: SearchCell, query: string, max: number, ctx: ProviderContext): Promise<PlaceRef[]> {
    throwIfAborted(ctx.signal);
    const hl = encodeURIComponent(ctx.settings.language);
    const url = cell.center
      ? `https://www.google.com/maps/search/${encodeURIComponent(query)}/@${cell.center.lat.toFixed(6)},${cell.center.lng.toFixed(6)},${radiusToZoom(cell.radiusM ?? 1000, cell.center.lat)}z?hl=${hl}`
      : `https://www.google.com/maps/search/${encodeURIComponent(`${query} en ${cell.text}`)}?hl=${hl}`;

    ctx.log(`Buscando "${query}" en ${cell.zoneLabel}…`);
    const win = await this.load(url, ctx);
    const result = (await abortable(win.webContents.executeJavaScript(serialize(collectResults, max), true), ctx.signal)) as
      | ResultsPage
      | { blocked: string };
    if ('blocked' in result) throw new Error(result.blocked);
    if (result.limited && !this.warnedLimited) {
      this.warnedLimited = true;
      ctx.waitingUser(
        'Atención: sin sesión de Google, Maps corta cada búsqueda en ~8 resultados. Iniciá sesión (botón arriba a la derecha) para obtener más.',
      );
    }

    const refs: PlaceRef[] = [];
    for (const r of result.links) {
      const id = placeIdFromUrl(r.url);
      if (id) refs.push({ id, url: r.url, name: r.name, location: locationFromUrl(r.url) });
    }
    ctx.log(`${refs.length} resultados para "${query}" en ${cell.zoneLabel}`);
    await politeDelay(ctx);
    return refs;
  }

  async details(ref: PlaceRef, ctx: ProviderContext): Promise<RawPlace | undefined> {
    if (!ref.url) return undefined;
    throwIfAborted(ctx.signal);
    const win = await this.load(ref.url, ctx);
    const data = (await abortable(
      win.webContents.executeJavaScript(serialize(extractPlace, { fetchReviews: ctx.fetchReviews, maxReviews: MAX_REVIEWS }), true),
      ctx.signal,
    )) as ExtractedPlace | { blocked: string };
    if ('blocked' in data) throw new Error(data.blocked);

    const finalUrl = win.webContents.getURL();
    const name = data.name ?? ref.name ?? '(sin nombre)';
    const now = new Date();

    await politeDelay(ctx);
    return {
      id: ref.id,
      name,
      category: data.category,
      address: data.address,
      phone: data.phone,
      website: data.website,
      rating: data.rating,
      reviewCount: data.reviewCount ?? 0,
      location: locationFromUrl(finalUrl) ?? locationFromUrl(ref.url),
      mapsUrl: ref.url,
      businessStatus: data.status,
      recentlyOpenedLabel: data.recentlyOpened,
      reviewsSortedByNewest: ctx.fetchReviews ? data.reviewsSortedByNewest : undefined,
      reviews: data.reviews.map((r) => ({
        author: r.author,
        rating: r.rating,
        text: r.text,
        relativeDate: r.relativeDate,
        date: parseRelativeDate(r.relativeDate, now),
      })),
    };
  }

  dispose(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = undefined;
  }
}
