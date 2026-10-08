import { api, BaseElement, html, sheet } from '../base';
import { state } from '../state';

type View = 'businesses' | 'scan' | 'settings';

/** Layout principal con navegación por pestañas. Las vistas se mantienen montadas para conservar su estado. */
export class AppShell extends BaseElement {
  static styles = sheet(`
    :host { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
    header { display: flex; align-items: center; gap: 24px; padding: 0 20px; height: 52px; border-bottom: 1px solid var(--border); background: var(--surface); }
    .brand { font-weight: 800; font-size: 15px; letter-spacing: -.01em; }
    .brand span { color: var(--accent); }
    nav { display: flex; gap: 4px; }
    nav button { background: none; border: none; border-radius: 6px; color: var(--muted); padding: 6px 12px; }
    nav button[aria-current=page] { color: var(--fg); background: var(--surface-2); }
    .scan-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); display: none; animation: pulse 1s infinite alternate; }
    .scan-dot.on { display: inline-block; }
    @keyframes pulse { to { opacity: .3; } }
    main { overflow: hidden; padding: 16px 20px; }
    .view { display: none; height: 100%; }
    .view.on { display: block; }
    #businesses.on { display: grid; grid-template-rows: auto auto 1fr; gap: 12px; }
    .split { display: grid; grid-template-columns: 1fr 420px; gap: 12px; min-height: 0; }
    .split > * { min-height: 0; }
    #scan, #settings { overflow: auto; }
    .spacer { flex: 1; }
    .scanning { display: none; align-items: center; gap: 10px; }
    .scanning.on { display: flex; }
    .scanning .msg { color: var(--muted); font-size: 12px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #stop { background: var(--danger); border-color: var(--danger); color: #fff; font-weight: 600; padding: 5px 12px; }
  `);

  private view: View = 'businesses';

  connectedCallback(): void {
    super.connectedCallback();
    void state.refresh();
    api().onDataChanged(() => void state.refresh());
    api().onScanProgress((p) => {
      const running = !['done', 'error', 'cancelled'].includes(p.phase);
      this.setScanning(running);
      this.$('#scan-msg').textContent =
        p.phase === 'details' && p.total ? `Escaneando ${p.done}/${p.total} lugares` : p.message;
    });
    void api().isScanning().then((r) => this.setScanning(r));
  }

  protected template() {
    return html`
      <header>
        <div class="brand">Comercial<span>Scrapper</span></div>
        <nav>
          <button data-view="businesses" aria-current="page">Negocios</button>
          <button data-view="scan">Escanear <span class="scan-dot" title="Escaneo en curso"></span></button>
          <button data-view="settings">Configuración</button>
        </nav>
        <span class="spacer"></span>
        <div class="scanning" id="scanning">
          <span class="msg" id="scan-msg">Escaneando…</span>
          <button id="stop" title="Detiene el escaneo; lo ya analizado queda guardado">■ Detener escaneo</button>
        </div>
        <session-badge></session-badge>
      </header>
      <main>
        <section class="view on" id="businesses">
          <stats-bar></stats-bar>
          <business-filters></business-filters>
          <div class="split">
            <business-table></business-table>
            <business-detail></business-detail>
          </div>
        </section>
        <section class="view" id="scan"><scan-panel></scan-panel></section>
        <section class="view" id="settings"><settings-panel></settings-panel></section>
      </main>
    `;
  }

  private setScanning(on: boolean): void {
    this.$('.scan-dot').classList.toggle('on', on);
    this.$('#scanning').classList.toggle('on', on);
    const stop = this.$<HTMLButtonElement>('#stop');
    if (on && stop.textContent === 'Deteniendo…') return;
    stop.disabled = false;
    stop.textContent = '■ Detener escaneo';
  }

  protected afterRender(): void {
    this.$('#stop').addEventListener('click', () => {
      const stop = this.$<HTMLButtonElement>('#stop');
      stop.disabled = true;
      stop.textContent = 'Deteniendo…';
      void api().cancelScan();
    });
    for (const btn of this.$$('nav button')) {
      btn.addEventListener('click', () => this.show(btn.dataset.view as View));
    }
  }

  private show(view: View): void {
    this.view = view;
    for (const btn of this.$$('nav button')) {
      if (btn.dataset.view === this.view) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
    for (const v of this.$$('.view')) v.classList.toggle('on', v.id === this.view);
  }
}
customElements.define('app-shell', AppShell);
