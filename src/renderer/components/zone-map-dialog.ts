import L from 'leaflet';
import leafletCss from 'leaflet/dist/leaflet.css';
import { boundsGrid, boundsSizeKm, MAX_CELLS } from '../../shared/grid';
import type { Bounds, GeocodeResult, ZoneSpec } from '../../shared/types';
import { api, BaseElement, html, sheet } from '../base';

const CELL_OPTIONS = [0.5, 1, 1.5, 2, 3, 5];

/**
 * Diálogo con mapa para elegir una zona: se busca por nombre ("Palermo, Buenos Aires"), el mapa se centra
 * ahí y se marca el área a cubrir arrastrando un rectángulo. Se muestra la grilla de búsquedas resultante.
 */
export class ZoneMapDialog extends BaseElement {
  static styles = sheet(`
    ${leafletCss}
    dialog {
      width: min(1200px, 94vw); height: min(820px, 92vh); padding: 0; border: 1px solid var(--border);
      border-radius: 12px; background: var(--surface); color: var(--fg);
    }
    dialog::backdrop { background: rgba(0, 0, 0, .55); }
    .layout { display: grid; grid-template-rows: auto auto 1fr auto; height: 100%; }
    .bar { display: flex; gap: 8px; padding: 12px 16px; align-items: center; border-bottom: 1px solid var(--border); }
    .bar input[name=q] { flex: 1; }
    .bar input[name=label] { flex: 1; }
    .bar select { width: auto; }
    .results { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 16px; }
    .results:not(:empty) { padding: 8px 16px; border-bottom: 1px solid var(--border); }
    .results button { font-size: 12px; padding: 3px 8px; max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .results button.on { border-color: var(--accent); color: var(--accent); }
    .map { position: relative; min-height: 0; }
    #map { position: absolute; inset: 0; }
    #map.drawing, #map.drawing .leaflet-interactive, #map.drawing .leaflet-grab { cursor: crosshair; }
    .hint {
      position: absolute; z-index: 1000; top: 12px; left: 50%; transform: translateX(-50%);
      background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px;
      font-size: 12px; box-shadow: 0 2px 10px rgba(0,0,0,.25); pointer-events: none;
    }
    .foot { display: flex; gap: 8px; padding: 12px 16px; align-items: center; border-top: 1px solid var(--border); }
    .foot .info { flex: 1; color: var(--muted); }
    .foot .info b { color: var(--fg); }
    button.active { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .err { color: var(--danger); }
    .foot label.inline { white-space: nowrap; color: var(--muted); font-size: 12px; }
    /* El ícono de capas de Leaflet es una imagen relativa que no existe dentro del bundle: se usa texto. */
    .leaflet-control-layers-toggle { background-image: none !important; width: auto !important; height: auto !important;
      padding: 6px 10px; font: 600 12px var(--font); color: #333; text-decoration: none; }
    .leaflet-control-layers-toggle::after { content: 'Capas'; }
  `);

  private map: L.Map | undefined;
  private rect: L.Rectangle | undefined;
  private gridLayer = L.layerGroup();
  private bounds: Bounds | undefined;
  private drawing = false;
  private results: GeocodeResult[] = [];
  private resolve: ((z: ZoneSpec | undefined) => void) | undefined;

  protected template() {
    return html`
      <dialog>
        <div class="layout">
          <form class="bar" id="search">
            <input name="q" placeholder="Buscar zona: Palermo, Buenos Aires" autocomplete="off" />
            <button type="submit" class="primary">Buscar</button>
          </form>
          <div class="results" id="results"></div>
          <div class="map">
            <div id="map"></div>
            <div class="hint" id="hint" hidden>Hacé click y arrastrá para marcar el área a cubrir</div>
          </div>
          <div class="foot">
            <button type="button" id="draw">Dibujar área</button>
            <button type="button" id="view">Usar vista actual</button>
            <label class="inline">Celdas
              <select id="cell">${CELL_OPTIONS.map((c) => html`<option value="${c}" ${c === 1 ? html`selected` : ''}>${c} km</option>`)}</select>
            </label>
            <span class="info" id="info">Buscá una zona y marcá el área.</span>
            <input name="label" id="label" placeholder="Nombre de la zona" style="max-width:260px" />
            <button type="button" id="cancel">Cancelar</button>
            <button type="button" class="primary" id="ok" disabled>Agregar zona</button>
          </div>
        </div>
      </dialog>
    `;
  }

  protected afterRender(): void {
    const dialog = this.$<HTMLDialogElement>('dialog');
    dialog.addEventListener('close', () => this.finish(undefined));
    this.$('#search').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.search(this.$<HTMLInputElement>('input[name=q]').value);
    });
    this.$('#results').addEventListener('click', (e) => {
      const i = (e.target as HTMLElement).closest<HTMLElement>('button[data-i]')?.dataset.i;
      if (i !== undefined) this.applyResult(Number(i));
    });
    this.$('#draw').addEventListener('click', () => this.setDrawing(!this.drawing));
    this.$('#view').addEventListener('click', () => {
      if (this.map) this.setBounds(toBounds(this.map.getBounds()));
    });
    this.$('#cell').addEventListener('change', () => this.updateGrid());
    this.$('#label').addEventListener('input', () => this.updateOk());
    this.$('#cancel').addEventListener('click', () => dialog.close());
    this.$('#ok').addEventListener('click', () => {
      if (!this.bounds) return;
      this.finish({
        label: this.$<HTMLInputElement>('#label').value.trim(),
        bounds: this.bounds,
        cellKm: Number(this.$<HTMLSelectElement>('#cell').value),
      });
      dialog.close();
    });
  }

  /** Abre el diálogo; resuelve con la zona elegida o undefined si se cancela. */
  open(initialQuery = ''): Promise<ZoneSpec | undefined> {
    const dialog = this.$<HTMLDialogElement>('dialog');
    dialog.showModal();
    this.initMap();
    requestAnimationFrame(() => this.map?.invalidateSize());
    const q = this.$<HTMLInputElement>('input[name=q]');
    q.value = initialQuery;
    q.focus();
    if (initialQuery.trim()) void this.search(initialQuery);
    return new Promise((resolve) => (this.resolve = resolve));
  }

  private finish(zone: ZoneSpec | undefined): void {
    this.setDrawing(false);
    this.resolve?.(zone);
    this.resolve = undefined;
  }

  private initMap(): void {
    if (this.map) return;
    const google = L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&hl=es&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      maxZoom: 20,
      attribution: 'Mapa © Google',
    });
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    });
    this.map = L.map(this.$('#map'), { layers: [google], zoomControl: true }).setView([-34.6037, -58.3816], 12);
    L.control.layers({ 'Google Maps': google, OpenStreetMap: osm }, undefined, { position: 'topright' }).addTo(this.map);
    this.gridLayer.addTo(this.map);
    this.bindDrawing(this.map);
  }

  /** Dibujo de rectángulo con el mouse (sin plugins): mientras está activo se desactiva el arrastre del mapa. */
  private bindDrawing(map: L.Map): void {
    let start: L.LatLng | undefined;
    let preview: L.Rectangle | undefined;
    map.on('mousedown', (e: L.LeafletMouseEvent) => {
      if (!this.drawing) return;
      start = e.latlng;
      preview = L.rectangle(L.latLngBounds(start, start), { color: '#4c8dff', weight: 2, dashArray: '4' }).addTo(map);
    });
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (start && preview) preview.setBounds(L.latLngBounds(start, e.latlng));
    });
    map.on('mouseup', (e: L.LeafletMouseEvent) => {
      if (!start || !preview) return;
      const b = L.latLngBounds(start, e.latlng);
      preview.remove();
      start = undefined;
      preview = undefined;
      this.setDrawing(false);
      // Un click sin arrastrar no define un área.
      if (map.latLngToContainerPoint(b.getNorthEast()).distanceTo(map.latLngToContainerPoint(b.getSouthWest())) > 10) {
        this.setBounds(toBounds(b), false);
      }
    });
  }

  private setDrawing(on: boolean): void {
    this.drawing = on;
    if (!this.map) return;
    if (on) this.map.dragging.disable();
    else this.map.dragging.enable();
    this.$('#map').classList.toggle('drawing', on);
    this.$('#draw').classList.toggle('active', on);
    this.$('#hint').hidden = !on;
  }

  private async search(query: string): Promise<void> {
    const q = query.trim();
    if (!q) return;
    const info = this.$('#info');
    info.textContent = 'Buscando…';
    info.className = 'info';
    this.results = await api().geocode(q).catch(() => []);
    if (!this.$<HTMLInputElement>('#label').value.trim()) this.$<HTMLInputElement>('#label').value = q;
    if (!this.results.length) {
      info.textContent = 'No se encontró esa zona. Probá con "barrio, ciudad" o navegá el mapa y dibujá el área.';
      info.className = 'info err';
      this.$('#results').innerHTML = '';
      return;
    }
    this.$('#results').innerHTML = this.results.length > 1
      ? html`${this.results.map((r, i) => html`<button type="button" data-i="${i}" title="${r.label}">${r.label}</button>`)}`.value
      : '';
    this.applyResult(0);
  }

  private applyResult(i: number): void {
    const r = this.results[i];
    if (!r || !this.map) return;
    this.$$('#results button').forEach((b) => b.classList.toggle('on', b.dataset.i === String(i)));
    if (r.bounds) {
      this.setBounds(r.bounds);
    } else {
      this.map.setView([r.center.lat, r.center.lng], 15);
      this.setBounds(toBounds(this.map.getBounds().pad(-0.25)));
    }
  }

  private setBounds(b: Bounds, fit = true): void {
    this.bounds = b;
    const lb = L.latLngBounds([b.south, b.west], [b.north, b.east]);
    if (this.rect) this.rect.setBounds(lb);
    else if (this.map) this.rect = L.rectangle(lb, { color: '#4c8dff', weight: 2, fillOpacity: 0.08 }).addTo(this.map);
    if (fit) this.map?.fitBounds(lb, { padding: [30, 30] });
    this.updateGrid();
  }

  private updateGrid(): void {
    this.gridLayer.clearLayers();
    if (!this.bounds) return;
    const b = this.bounds;
    const cellKm = Number(this.$<HTMLSelectElement>('#cell').value);
    const { rows, cols } = boundsGrid(b, cellKm);
    const style = { color: '#4c8dff', weight: 1, opacity: 0.5, interactive: false };
    for (let i = 1; i < rows; i++) {
      const lat = b.south + ((b.north - b.south) * i) / rows;
      L.polyline([[lat, b.west], [lat, b.east]], style).addTo(this.gridLayer);
    }
    for (let j = 1; j < cols; j++) {
      const lng = b.west + ((b.east - b.west) * j) / cols;
      L.polyline([[b.south, lng], [b.north, lng]], style).addTo(this.gridLayer);
    }
    const { widthKm, heightKm } = boundsSizeKm(b);
    const cells = rows * cols;
    this.$('#info').className = 'info';
    this.$('#info').innerHTML = html`Área <b>${widthKm.toFixed(1)} × ${heightKm.toFixed(1)} km</b> ·
      <b>${cells}</b> búsqueda${cells === 1 ? '' : 's'} por rubro${cells >= MAX_CELLS ? ' (máximo, se agrandaron las celdas)' : ''}`.value;
    this.updateOk();
  }

  private updateOk(): void {
    this.$<HTMLButtonElement>('#ok').disabled = !this.bounds || !this.$<HTMLInputElement>('#label').value.trim();
  }
}

function toBounds(b: L.LatLngBounds): Bounds {
  return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
}

customElements.define('zone-map-dialog', ZoneMapDialog);
