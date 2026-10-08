import type { Business, LeadStatus } from '../../shared/types';
import { api, BaseElement, daysAgo, fmtDate, html, sheet } from '../base';
import { state } from '../state';

const STATUSES: LeadStatus[] = ['pendiente', 'contactado', 'interesado', 'cliente', 'descartado'];

/** Panel lateral con el detalle, motivos de la clasificación, reseñas y seguimiento comercial. */
export class BusinessDetail extends BaseElement {
  static styles = sheet(`
    :host { overflow: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
    .wrap { padding: 16px; display: grid; gap: 16px; }
    .empty { padding: 48px 24px; text-align: center; color: var(--muted); }
    header { display: grid; gap: 4px; }
    .title { display: flex; justify-content: space-between; gap: 8px; align-items: start; }
    .title h2 { font-size: 18px; margin: 0; }
    .big { font-size: 28px; font-weight: 800; line-height: 1; }
    .big.alto { color: var(--ok); } .big.medio { color: var(--warn); } .big.bajo { color: var(--danger); }
    dl { display: grid; grid-template-columns: 110px 1fr; gap: 4px 8px; margin: 0; }
    dt { color: var(--muted); } dd { margin: 0; word-break: break-word; }
    ul { margin: 0; padding-left: 18px; display: grid; gap: 2px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .opp { background: var(--accent-bg); color: var(--accent); }
    .review { border-top: 1px solid var(--border); padding: 8px 0; }
    .review .meta { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; }
    .review p { margin: 4px 0 0; white-space: pre-wrap; }
    .stars { color: var(--warn); }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    td, th { padding: 3px 6px; text-align: left; border-bottom: 1px solid var(--border); }
    textarea { font-family: var(--font); font-size: 13px; min-height: 70px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  `);

  private onChange = () => {
    // Evita re-render mientras se escriben notas.
    if (this.root.activeElement?.tagName === 'TEXTAREA') return;
    this.render();
  };

  connectedCallback(): void {
    super.connectedCallback();
    state.addEventListener('change', this.onChange);
  }

  disconnectedCallback(): void {
    state.removeEventListener('change', this.onChange);
  }

  private section(title: string, body: unknown) {
    return html`<section><h4>${title}</h4>${body}</section>`;
  }

  private list(items: string[], empty = 'Sin datos') {
    return items.length ? html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>` : html`<span class="muted">${empty}</span>`;
  }

  protected template() {
    const b: Business | undefined = state.selected;
    if (!b) return html`<div class="empty">Seleccioná un negocio para ver el detalle.</div>`;
    const c = b.classification;

    return html`
      <div class="wrap">
        <header>
          <div class="title">
            <div>
              <h2>${b.name}</h2>
              <div class="muted">${b.category ?? 'Sin rubro'}</div>
            </div>
            <div style="text-align:right">
              <div class="big ${c.leadTier}">${c.leadScore}</div>
              <div class="muted">potencial ${c.leadTier}</div>
            </div>
          </div>
          <div class="chips">
            <span class="chip ${c.activity}">${c.activity}</span>
            ${c.isNewBusiness ? html`<span class="chip nuevo">negocio nuevo</span>` : ''}
            ${c.newReviewsSinceLastScan ? html`<span class="chip activo">+${c.newReviewsSinceLastScan} reseñas desde el último escaneo</span>` : ''}
          </div>
        </header>

        <div class="actions">
          ${b.mapsUrl ? html`<button data-open="${b.mapsUrl}">Ver en Google Maps</button>` : ''}
          ${b.website ? html`<button data-open="${b.website}">Abrir sitio web</button>` : ''}
        </div>

        <dl>
          <dt>Dirección</dt><dd>${b.address ?? '—'}</dd>
          <dt>Teléfono</dt><dd>${b.phone ?? '—'}</dd>
          <dt>Sitio web</dt><dd>${b.website ?? 'No tiene'}</dd>
          <dt>Calificación</dt><dd>${b.rating !== undefined ? html`<span class="stars">★</span> ${b.rating.toFixed(1)}` : '—'} (${b.reviewCount ?? 0} reseñas)</dd>
          <dt>Última reseña</dt><dd>${fmtDate(c.latestReviewDate)} (${daysAgo(c.daysSinceLastReview)})</dd>
          <dt>Visto desde</dt><dd>${fmtDate(b.firstSeenAt)}</dd>
          <dt>Zonas</dt><dd>${b.zones.join(', ')}</dd>
          <dt>Búsquedas</dt><dd>${b.queries.join(', ')}</dd>
        </dl>

        ${this.section('Oportunidades de venta', c.opportunities.length
          ? html`<div class="chips">${c.opportunities.map((o) => html`<span class="chip opp">${o}</span>`)}</div>`
          : html`<span class="muted">Sin oportunidades detectadas</span>`)}
        ${this.section('Por qué este puntaje', this.list(c.leadReasons))}
        ${this.section('Señales de negocio nuevo', this.list(c.newBusinessReasons, 'Ninguna'))}

        <section>
          <h4>Seguimiento comercial</h4>
          <div style="display:grid;gap:8px">
            <select id="status">${STATUSES.map((s) => html`<option value="${s}" ${s === b.leadStatus ? html`selected` : ''}>${s}</option>`)}</select>
            <textarea id="notes" placeholder="Notas: con quién hablaste, qué necesita, próximos pasos…">${b.notes}</textarea>
          </div>
        </section>

        ${this.section(`Reseñas recientes (${b.reviews.length})`, b.reviews.length
          ? b.reviews.slice(0, 15).map((r) => html`
              <div class="review">
                <div class="meta"><span>${r.author ?? 'Anónimo'} ${r.rating ? html`<span class="stars">${'★'.repeat(Math.round(r.rating))}</span>` : ''}</span>
                <span>${r.relativeDate ?? fmtDate(r.date)}</span></div>
                ${r.text ? html`<p>${r.text}</p>` : ''}
              </div>`)
          : html`<span class="muted">No se obtuvieron reseñas (activá "Leer reseñas" al escanear).</span>`)}

        ${this.section('Historial de escaneos', html`
          <table><thead><tr><th>Fecha</th><th>★</th><th>Reseñas</th></tr></thead>
          <tbody>${[...b.history].reverse().slice(0, 12).map((h) => html`<tr><td>${fmtDate(h.at)}</td><td>${h.rating ?? '—'}</td><td>${h.reviewCount ?? '—'}</td></tr>`)}</tbody></table>`)}

        <div class="actions"><button class="danger" id="delete">Eliminar de la base</button></div>
      </div>
    `;
  }

  protected afterRender(): void {
    const b = state.selected;
    if (!b) return;
    for (const btn of this.$$('[data-open]')) {
      btn.addEventListener('click', () => void api().openExternal(btn.dataset.open!));
    }
    this.$<HTMLSelectElement>('#status').addEventListener('change', async (e) => {
      const updated = await api().updateBusiness(b.id, { leadStatus: (e.target as HTMLSelectElement).value as LeadStatus });
      if (updated) state.replace(updated);
    });
    const notes = this.$<HTMLTextAreaElement>('#notes');
    notes.addEventListener('blur', async () => {
      if (notes.value === b.notes) return;
      const updated = await api().updateBusiness(b.id, { notes: notes.value });
      if (updated) state.replace(updated);
    });
    this.$('#delete').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar "${b.name}" de la base?`)) return;
      await api().deleteBusiness(b.id);
      state.remove(b.id);
    });
  }
}
customElements.define('business-detail', BusinessDetail);
