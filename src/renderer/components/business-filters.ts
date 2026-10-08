import { api, BaseElement, html, sheet } from '../base';
import { DEFAULT_FILTERS, state, type Filters } from '../state';

/** Barra de filtros. Se renderiza una sola vez (para no perder el foco) y sincroniza valores con el estado. */
export class BusinessFilters extends BaseElement {
  static styles = sheet(`
    :host { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    input[type=search] { width: 240px; }
    select { width: auto; }
    .spacer { flex: 1; }
  `);

  private onChange = () => this.sync();

  connectedCallback(): void {
    super.connectedCallback();
    state.addEventListener('change', this.onChange);
  }

  disconnectedCallback(): void {
    state.removeEventListener('change', this.onChange);
  }

  protected template() {
    return html`
      <input type="search" name="text" placeholder="Buscar nombre, rubro, dirección, notas…" />
      <select name="tier" title="Potencial">
        <option value="">Potencial: todos</option>
        <option value="alto">Alto</option><option value="medio">Medio</option><option value="bajo">Bajo</option>
      </select>
      <select name="activity" title="Actividad">
        <option value="">Actividad: todas</option>
        <option value="activo">Activo</option><option value="moderado">Moderado</option>
        <option value="inactivo">Inactivo</option><option value="desconocido">Desconocido</option><option value="cerrado">Cerrado</option>
      </select>
      <select name="leadStatus" title="Estado comercial">
        <option value="">Estado: todos</option>
        <option value="pendiente">Pendiente</option><option value="contactado">Contactado</option>
        <option value="interesado">Interesado</option><option value="cliente">Cliente</option><option value="descartado">Descartado</option>
      </select>
      <select name="zone" title="Zona"><option value="">Zona: todas</option></select>
      <label class="inline"><input type="checkbox" name="onlyNew" /> Solo nuevos</label>
      <label class="inline"><input type="checkbox" name="noWebsite" /> Sin web</label>
      <button id="reset">Limpiar</button>
      <span class="spacer"></span>
      <span class="muted" id="count"></span>
      <button id="export" class="primary">Exportar CSV</button>
    `;
  }

  protected afterRender(): void {
    for (const el of this.$$<HTMLInputElement | HTMLSelectElement>('[name]')) {
      el.addEventListener(el instanceof HTMLInputElement && el.type === 'search' ? 'input' : 'change', () => {
        const value = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
        state.setFilters({ [el.name]: value } as Partial<Filters>);
      });
    }
    this.$('#reset').addEventListener('click', () => state.setFilters({ ...DEFAULT_FILTERS }));
    this.$('#export').addEventListener('click', async () => {
      const ids = state.filtered.map((b) => b.id);
      if (ids.length) await api().exportCsv(ids);
    });
    this.sync();
  }

  private sync(): void {
    const f = state.filters;
    const zoneSel = this.$<HTMLSelectElement>('select[name=zone]');
    const zones = state.zones;
    if (zoneSel.options.length - 1 !== zones.length) {
      zoneSel.innerHTML = html`<option value="">Zona: todas</option>${zones.map((z) => html`<option>${z}</option>`)}`.value;
    }
    for (const el of this.$$<HTMLInputElement | HTMLSelectElement>('[name]')) {
      const v = f[el.name as keyof Filters];
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!v;
      else if (this.root.activeElement !== el) el.value = String(v);
    }
    this.$('#count').textContent = `${state.filtered.length} de ${state.businesses.length}`;
  }
}
customElements.define('business-filters', BusinessFilters);
