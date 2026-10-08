import type { Provider, ScanProgress, ScanRecord } from '../../shared/types';
import { api, BaseElement, fmtDate, html, sheet } from '../base';
import { zoneToCells } from '../../shared/grid';
import { formatBoundsZone, parseZones } from '../zones';
import type { ZoneMapDialog } from './zone-map-dialog';

const DRAFT_KEY = 'scan-draft';
const MAX_LOG = 300;

const DEFAULT_DRAFT = {
  zones: 'Palermo, Buenos Aires\n# Centro Córdoba | -31.4167,-64.1833 | 2 | 3',
  queries: 'restaurantes\nfarmacias\npeluquerías\nferreterías\nconsultorios',
  max: 40,
  provider: 'browser' as Provider,
  reviews: true,
};

/** Formulario de escaneo + progreso en vivo + historial. */
export class ScanPanel extends BaseElement {
  static styles = sheet(`
    :host { display: grid; grid-template-columns: minmax(380px, 1fr) minmax(380px, 1.2fr); gap: 16px; align-items: start; }
    form { display: grid; gap: 12px; }
    .help { font-size: 12px; color: var(--muted); margin: 0; }
    .help code { font-family: var(--mono); background: var(--bg); padding: 0 4px; border-radius: 4px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .errors { color: var(--danger); font-size: 12px; white-space: pre-line; }
    .bar { height: 8px; background: var(--bg); border-radius: 999px; overflow: hidden; margin: 8px 0; }
    .bar > div { height: 100%; background: var(--accent); width: 0; transition: width .3s; }
    .status { font-weight: 600; }
    .status.waiting-user { color: var(--warn); } .status.error { color: var(--danger); } .status.done { color: var(--ok); }
    .log { font-family: var(--mono); font-size: 11px; max-height: 300px; overflow: auto; background: var(--bg); border-radius: 6px; padding: 8px; margin: 0; white-space: pre-wrap; }
    .right { display: grid; gap: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    td, th { padding: 4px 6px; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 600; }
    .zones-head { display: flex; justify-content: space-between; align-items: end; gap: 8px; }
    .zones-head span { color: var(--muted); font-size: 12px; }
    #pick { font-weight: 600; }
    #cancel { background: var(--danger); border-color: var(--danger); color: #fff; font-weight: 600; }
    .session { display: flex; align-items: center; gap: 8px; }
  `);

  private unsubscribe: (() => void) | undefined;
  private running = false;
  /** Línea del textarea de zonas donde estaba el cursor (el botón del mapa le quita el foco). */
  private caretLine = -1;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = api().onScanProgress((p) => this.onProgress(p));
    void this.loadHistory();
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
  }

  protected template() {
    return html`
      <form class="card">
        <h2>Nuevo escaneo</h2>
        <div class="zones-head">
          <span>Zonas (una por línea)</span>
          <button type="button" id="pick">Marcar zona en el mapa</button>
        </div>
        <textarea name="zones" rows="5" aria-label="Zonas"></textarea>
        <p class="help">
          Escribí una zona (<code>Palermo, Buenos Aires</code>) y tocá <b>Marcar zona en el mapa</b> para delimitar el
          área exacta: la línea se reemplaza por el rectángulo marcado y se descartan los resultados que queden fuera.
          También podés dejar el texto solo (búsqueda simple) o usar <code>Nombre | lat,lng | radio km | grilla</code>.
          Las líneas con <code>#</code> se ignoran.
        </p>
        <label>Rubros / búsquedas (una por línea)
          <textarea name="queries" rows="5"></textarea>
        </label>
        <div class="grid2">
          <label>Máx. resultados por búsqueda
            <input name="max" type="number" min="5" max="120" step="5" />
          </label>
          <label>Fuente
            <select name="provider">
              <option value="browser">Google Maps (navegador, sin API key)</option>
              <option value="places">Google Places API (oficial)</option>
            </select>
          </label>
        </div>
        <div class="session" id="session"><session-badge></session-badge></div>
        <label class="inline"><input type="checkbox" name="reviews" /> Leer reseñas (necesario para medir actividad; más lento)</label>
        <div class="errors" id="errors"></div>
        <div class="row">
          <button type="submit" class="primary" id="start">Iniciar escaneo</button>
          <button type="button" id="cancel" hidden>■ Detener escaneo</button>
          <span class="muted" id="estimate"></span>
        </div>
      </form>

      <div class="right">
        <div class="card">
          <h2>Progreso</h2>
          <div class="status" id="status">Sin escaneos en curso.</div>
          <div class="bar"><div id="bar"></div></div>
          <pre class="log" id="log"></pre>
        </div>
        <div class="card">
          <h2>Historial</h2>
          <div id="history" class="muted">—</div>
        </div>
      </div>
      <zone-map-dialog></zone-map-dialog>
    `;
  }

  protected afterRender(): void {
    const form = this.$<HTMLFormElement>('form');
    const draft = this.loadDraft();
    (form.elements.namedItem('zones') as HTMLTextAreaElement).value = draft.zones;
    (form.elements.namedItem('queries') as HTMLTextAreaElement).value = draft.queries;
    (form.elements.namedItem('max') as HTMLInputElement).value = String(draft.max);
    (form.elements.namedItem('provider') as HTMLSelectElement).value = draft.provider;
    (form.elements.namedItem('reviews') as HTMLInputElement).checked = draft.reviews;

    form.addEventListener('input', () => {
      this.saveDraft();
      this.updateEstimate();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.start();
    });
    this.$('#cancel').addEventListener('click', () => this.stop());
    this.$('#pick').addEventListener('click', () => void this.pickZone());
    const zonesTa = this.$<HTMLTextAreaElement>('textarea[name=zones]');
    const trackCaret = () => (this.caretLine = zonesTa.value.slice(0, zonesTa.selectionStart).split(/\r?\n/).length - 1);
    for (const ev of ['keyup', 'click', 'select']) zonesTa.addEventListener(ev, trackCaret);
    this.updateEstimate();
    void api().isScanning().then((r) => r && this.setRunning(true));
  }

  private stop(): void {
    const btn = this.$<HTMLButtonElement>('#cancel');
    btn.disabled = true;
    btn.textContent = 'Deteniendo…';
    void api().cancelScan();
  }

  /**
   * Abre el mapa usando como búsqueda la línea de texto donde está el cursor (o la última zona de texto) y
   * reemplaza esa línea por el área marcada. Si no hay línea de texto, agrega la zona al final.
   */
  private async pickZone(): Promise<void> {
    const ta = this.$<HTMLTextAreaElement>('textarea[name=zones]');
    const lines = ta.value.split(/\r?\n/);
    const isText = (l: string) => !!l.trim() && !l.trim().startsWith('#') && !l.includes('|') && !/^\s*-?\d/.test(l);
    let idx = isText(lines[this.caretLine] ?? '') ? this.caretLine : lines.map(isText).lastIndexOf(true);

    const dialog = this.$<ZoneMapDialog>('zone-map-dialog');
    const zone = await dialog.open(idx >= 0 ? lines[idx].trim() : '');
    if (!zone) return;
    const line = formatBoundsZone(zone);
    if (idx >= 0) lines[idx] = line;
    else {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      lines.push(line);
      idx = lines.length - 1;
    }
    ta.value = lines.join('\n');
    this.caretLine = idx;
    this.saveDraft();
    this.updateEstimate();
  }

  private readForm() {
    const form = this.$<HTMLFormElement>('form');
    const get = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
    return {
      zones: get('zones').value,
      queries: get('queries').value,
      max: Number(get('max').value) || 40,
      provider: get('provider').value as Provider,
      reviews: get('reviews').checked,
    };
  }

  private loadDraft(): typeof DEFAULT_DRAFT {
    try {
      return { ...DEFAULT_DRAFT, ...JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') };
    } catch {
      return DEFAULT_DRAFT;
    }
  }

  private saveDraft(): void {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(this.readForm()));
    } catch {
      /* el borrador es opcional */
    }
  }

  private queriesOf(text: string): string[] {
    return [...new Set(text.split(/\r?\n/).map((q) => q.trim()).filter((q) => q && !q.startsWith('#')))];
  }

  private updateEstimate(): void {
    const f = this.readForm();
    const { zones } = parseZones(f.zones);
    const cells = zones.reduce((n, z) => n + zoneToCells(z).length, 0);
    const searches = cells * this.queriesOf(f.queries).length;
    this.$('#estimate').textContent = searches ? `${searches} búsquedas · hasta ~${searches * f.max} lugares` : '';
  }

  private async start(): Promise<void> {
    const f = this.readForm();
    const { zones, errors } = parseZones(f.zones);
    const queries = this.queriesOf(f.queries);
    if (!zones.length) errors.push('Agregá al menos una zona.');
    if (!queries.length) errors.push('Agregá al menos un rubro o búsqueda.');
    this.$('#errors').textContent = errors.join('\n');
    if (errors.length) return;

    this.$('#log').textContent = '';
    try {
      await api().startScan({ zones, queries, maxResultsPerQuery: f.max, provider: f.provider, fetchReviews: f.reviews });
      this.setRunning(true);
    } catch (err) {
      this.$('#errors').textContent = (err as Error).message;
    }
  }

  private setRunning(running: boolean): void {
    this.running = running;
    this.$<HTMLButtonElement>('#start').disabled = running;
    const cancel = this.$<HTMLButtonElement>('#cancel');
    cancel.hidden = !running;
    cancel.disabled = false;
    cancel.textContent = '■ Detener escaneo';
  }

  private onProgress(p: ScanProgress): void {
    if (!this.running && !['done', 'error', 'cancelled'].includes(p.phase)) this.setRunning(true);
    const status = this.$('#status');
    status.className = `status ${p.phase}`;
    status.textContent =
      p.phase === 'details' ? `Analizando ${p.done}/${p.total} · ${p.found} guardados` : p.message;
    this.$('#bar').style.width = p.total ? `${Math.round((p.done / p.total) * 100)}%` : p.phase === 'done' ? '100%' : '0%';

    const log = this.$('#log');
    const line = `[${new Date().toLocaleTimeString()}] ${p.message}\n`;
    log.textContent = (line + (log.textContent ?? '')).split('\n').slice(0, MAX_LOG).join('\n');

    if (['done', 'error', 'cancelled'].includes(p.phase)) {
      this.setRunning(false);
      void this.loadHistory();
    }
  }

  private async loadHistory(): Promise<void> {
    const scans: ScanRecord[] = await api().listScans();
    const el = this.$('#history');
    if (!scans.length) {
      el.textContent = 'Todavía no se hizo ningún escaneo.';
      return;
    }
    el.className = '';
    el.innerHTML = html`
      <table>
        <thead><tr><th>Fecha</th><th>Zonas</th><th>Búsquedas</th><th>Fuente</th><th>Lugares</th><th>Nuevos</th><th>Estado</th></tr></thead>
        <tbody>${scans.slice(0, 20).map((s) => html`
          <tr title="${s.error ?? ''}">
            <td>${fmtDate(s.startedAt)} ${new Date(s.startedAt).toLocaleTimeString()}</td>
            <td>${s.request.zones.map((z) => z.label).join(', ')}</td>
            <td>${s.request.queries.join(', ')}</td>
            <td>${s.request.provider === 'places' ? 'API' : 'Maps'}</td>
            <td>${s.found}</td><td>${s.newBusinesses}</td>
            <td>${s.status}</td>
          </tr>`)}</tbody>
      </table>`.value;
  }
}
customElements.define('scan-panel', ScanPanel);
