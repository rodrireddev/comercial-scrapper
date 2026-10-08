import { BaseElement, html, sheet } from '../base';
import { state } from '../state';

/** Tarjetas con totales; cada una aplica un filtro al hacer click. */
export class StatsBar extends BaseElement {
  static styles = sheet(`
    :host { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
    button { text-align: left; padding: 12px 14px; border-radius: 10px; background: var(--surface); }
    .n { font-size: 22px; font-weight: 700; display: block; }
    .l { color: var(--muted); font-size: 12px; }
    .ok .n { color: var(--ok); } .warn .n { color: var(--warn); } .acc .n { color: var(--accent); }
  `);

  private onChange = () => this.render();

  connectedCallback(): void {
    super.connectedCallback();
    state.addEventListener('change', this.onChange);
  }

  disconnectedCallback(): void {
    state.removeEventListener('change', this.onChange);
  }

  protected template() {
    const all = state.businesses;
    const count = (fn: (c: (typeof all)[number]['classification']) => boolean) => all.filter((b) => fn(b.classification)).length;
    return html`
      <button data-f="all"><span class="n">${all.length}</span><span class="l">Negocios en la base</span></button>
      <button data-f="hot" class="ok"><span class="n">${count((c) => c.leadTier === 'alto')}</span><span class="l">Leads de alto potencial</span></button>
      <button data-f="new" class="acc"><span class="n">${count((c) => c.isNewBusiness)}</span><span class="l">Negocios nuevos</span></button>
      <button data-f="active" class="ok"><span class="n">${count((c) => c.activity === 'activo')}</span><span class="l">Activos (reseñas recientes)</span></button>
      <button data-f="noweb" class="warn"><span class="n">${all.filter((b) => !b.website).length}</span><span class="l">Sin sitio web</span></button>
    `;
  }

  protected afterRender(): void {
    for (const btn of this.$$('button')) {
      btn.addEventListener('click', () => {
        const base = { tier: '', activity: '', onlyNew: false, noWebsite: false } as const;
        switch (btn.dataset.f) {
          case 'hot': return state.setFilters({ ...base, tier: 'alto' });
          case 'new': return state.setFilters({ ...base, onlyNew: true });
          case 'active': return state.setFilters({ ...base, activity: 'activo' });
          case 'noweb': return state.setFilters({ ...base, noWebsite: true });
          default: return state.setFilters(base);
        }
      });
    }
  }
}
customElements.define('stats-bar', StatsBar);
