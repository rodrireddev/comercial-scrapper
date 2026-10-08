import type { MapsSessionStatus } from '../../shared/types';
import { api, BaseElement, html, sheet } from '../base';

/**
 * Estado de la sesión de Google del scraper con botón para iniciar o cerrar sesión.
 * Se usa en la barra superior y en el formulario de escaneo.
 */
export class SessionBadge extends BaseElement {
  static styles = sheet(`
    :host { display: inline-flex; }
    .wrap { display: inline-flex; align-items: center; gap: 8px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warn); flex: none; }
    .dot.on { background: var(--ok); }
    .label { font-size: 12px; color: var(--muted); white-space: nowrap; }
    button { padding: 4px 10px; font-size: 12px; white-space: nowrap; }
    button.login { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 600; }
  `);

  private status: MapsSessionStatus | undefined;
  private unsubscribe: (() => void) | undefined;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = api().onMapsSessionChanged((s) => this.update(s));
    void api().getMapsSession().then((s) => this.update(s));
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
  }

  private update(s: MapsSessionStatus): void {
    this.status = s;
    this.render();
  }

  protected template() {
    if (!this.status) return html`<span class="label">Comprobando sesión de Google…</span>`;
    return this.status.loggedIn
      ? html`<span class="wrap" title="El scraper ve todas las reseñas ordenadas por fecha">
          <span class="dot on"></span><span class="label">Google: sesión iniciada</span>
          <button id="logout">Cerrar sesión</button></span>`
      : html`<span class="wrap" title="Sin sesión, Google puede mostrar pocas reseñas y sin orden por fecha">
          <span class="dot"></span><span class="label">Google: sin sesión</span>
          <button id="login" class="login">Iniciar sesión en Google</button></span>`;
  }

  protected afterRender(): void {
    this.root.querySelector('#login')?.addEventListener('click', () => void api().openMapsLogin());
    this.root.querySelector('#logout')?.addEventListener('click', async () => {
      if (confirm('¿Cerrar la sesión de Google del scraper? Solo afecta a esta aplicación.')) await api().logoutMaps();
    });
  }
}
customElements.define('session-badge', SessionBadge);
