import type { Business } from '../../shared/types';
import { BaseElement, daysAgo, html, sheet } from '../base';
import { state, type SortKey } from '../state';

const MAX_ROWS = 1000;

/** Tabla ordenable de negocios. Emite la selección a través del estado global. */
export class BusinessTable extends BaseElement {
  static styles = sheet(`
    :host { overflow: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: middle; }
    th { position: sticky; top: 0; background: var(--surface-2); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); z-index: 1; user-select: none; }
    th[data-sort] { cursor: pointer; }
    th[data-sort]:hover { color: var(--fg); }
    tbody tr { cursor: pointer; }
    tbody tr:hover { background: var(--hover); }
    tbody tr.sel { background: var(--selected); }
    .name { font-weight: 600; }
    .sub { color: var(--muted); font-size: 12px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .score { display: inline-grid; place-items: center; width: 36px; height: 24px; border-radius: 6px; font-weight: 700; font-size: 12px; }
    .score.alto { background: var(--ok-bg); color: var(--ok); }
    .score.medio { background: var(--warn-bg); color: var(--warn); }
    .score.bajo { background: var(--bad-bg); color: var(--danger); }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .chips { display: flex; gap: 4px; flex-wrap: wrap; }
    .empty { padding: 48px; text-align: center; color: var(--muted); }
  `);

  private onChange = () => this.render();

  connectedCallback(): void {
    super.connectedCallback();
    state.addEventListener('change', this.onChange);
  }

  disconnectedCallback(): void {
    state.removeEventListener('change', this.onChange);
  }

  private th(label: string, key?: SortKey, cls = '') {
    if (!key) return html`<th class="${cls}">${label}</th>`;
    const arrow = state.filters.sort === key ? (state.filters.desc ? ' ▼' : ' ▲') : '';
    return html`<th data-sort="${key}" class="${cls}">${label}${arrow}</th>`;
  }

  private row(b: Business) {
    const c = b.classification;
    return html`
      <tr data-id="${b.id}" class="${b.id === state.selectedId ? 'sel' : ''}">
        <td><span class="score ${c.leadTier}" title="Potencial ${c.leadTier}">${c.leadScore}</span></td>
        <td>
          <div class="name">${b.name}</div>
          <div class="sub">${b.category ?? ''}${b.category && b.address ? ' · ' : ''}${b.address ?? ''}</div>
        </td>
        <td class="num">${b.rating?.toFixed(1) ?? '—'}</td>
        <td class="num">${b.reviewCount ?? 0}${c.newReviewsSinceLastScan ? html` <span class="chip activo">+${c.newReviewsSinceLastScan}</span>` : ''}</td>
        <td>${daysAgo(c.daysSinceLastReview)}</td>
        <td>
          <div class="chips">
            <span class="chip ${c.activity}">${c.activity}</span>
            ${c.isNewBusiness ? html`<span class="chip nuevo">nuevo</span>` : ''}
            ${b.website ? '' : html`<span class="chip neutral">sin web</span>`}
          </div>
        </td>
        <td><span class="chip ${b.leadStatus}">${b.leadStatus}</span></td>
      </tr>`;
  }

  protected template() {
    const rows = state.filtered;
    if (!state.businesses.length) {
      return html`<div class="empty">Todavía no hay negocios. Andá a <b>Escanear</b> para buscar en una zona.</div>`;
    }
    return html`
      <table>
        <thead><tr>
          ${this.th('Pot.', 'score')}${this.th('Negocio', 'name')}${this.th('★', 'rating', 'num')}
          ${this.th('Reseñas', 'reviews', 'num')}${this.th('Últ. reseña', 'lastReview')}
          ${this.th('Señales')}${this.th('Estado')}
        </tr></thead>
        <tbody>${rows.slice(0, MAX_ROWS).map((b) => this.row(b))}</tbody>
      </table>
      ${rows.length === 0 ? html`<div class="empty">Ningún negocio coincide con los filtros.</div>` : ''}
      ${rows.length > MAX_ROWS ? html`<div class="empty">Mostrando ${MAX_ROWS} de ${rows.length}. Afiná los filtros o exportá a CSV.</div>` : ''}
    `;
  }

  protected afterRender(): void {
    this.root.querySelector('thead')?.addEventListener('click', (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('th[data-sort]')?.dataset.sort as SortKey | undefined;
      if (!key) return;
      const desc = state.filters.sort === key ? !state.filters.desc : key !== 'name';
      state.setFilters({ sort: key, desc });
    });
    this.root.querySelector('tbody')?.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('tr[data-id]')?.dataset.id;
      if (id) state.select(id);
    });
  }
}
customElements.define('business-table', BusinessTable);
