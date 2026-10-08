import type { Settings } from '../../shared/types';
import { api, BaseElement, html, sheet } from '../base';

export class SettingsPanel extends BaseElement {
  static styles = sheet(`
    :host { max-width: 820px; }
    form { display: grid; gap: 16px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .help { font-size: 12px; color: var(--muted); margin: 0; }
    #saved { color: var(--ok); }
  `);

  private settings: Settings | undefined;

  connectedCallback(): void {
    super.connectedCallback();
    void api().getSettings().then((s) => {
      this.settings = s;
      this.fill(s);
    });
  }

  protected template() {
    return html`
      <form class="card">
        <h2>Clasificación</h2>
        <div class="grid2">
          <label>Negocio "nuevo" si tiene menos de (meses)
            <input name="newBusinessMonths" type="number" min="1" max="36" />
          </label>
          <label>"Activo" si su última reseña tiene menos de (días)
            <input name="activeDays" type="number" min="7" max="365" />
          </label>
        </div>
        <label>Rubros prioritarios (uno por línea o separados por coma)
          <textarea name="targetCategories" rows="6"></textarea>
        </label>
        <p class="help">Los negocios cuyo rubro o nombre contenga alguno de estos términos suman puntos de potencial.</p>

        <h2>Fuentes</h2>
        <label>API key de Google Places (opcional)
          <input name="placesApiKey" type="password" autocomplete="off" placeholder="AIza…" />
        </label>
        <p class="help">
          Con la fuente "Google Places API" se usa la API oficial (estable, con costo por consulta y hasta 5 reseñas por lugar).
          La key se guarda localmente en la carpeta de datos de la aplicación.
        </p>
        <div class="grid2">
          <label>Pausa entre páginas en Maps (ms)
            <input name="delayMs" type="number" min="300" max="20000" step="100" />
          </label>
          <label>Idioma
            <select name="language"><option value="es">Español</option><option value="en">English</option><option value="pt-BR">Português</option></select>
          </label>
        </div>
        <div class="row">
          <session-badge></session-badge>
        </div>
        <p class="help">
          Sin sesión iniciada, Google Maps muestra una vista limitada: pocas reseñas y sin orden por fecha, lo que
          hace menos precisa la detección de actividad. La sesión queda guardada solo en la sesión aislada del scraper.
          Recomendado: usar una cuenta secundaria.
        </p>
        <label class="inline"><input type="checkbox" name="showBrowser" /> Mostrar la ventana de Google Maps mientras scrapea (útil para depurar)</label>

        <div class="row">
          <button type="submit" class="primary">Guardar y reclasificar</button>
          <span id="saved"></span>
        </div>
      </form>
    `;
  }

  protected afterRender(): void {
    this.$('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.settings) return;
      const saved = await api().saveSettings(this.read(this.settings));
      this.settings = saved;
      this.fill(saved);
      this.$('#saved').textContent = 'Guardado. Se reclasificaron todos los negocios.';
      setTimeout(() => (this.$('#saved').textContent = ''), 3000);
    });
  }

  private field<T extends HTMLElement = HTMLInputElement>(name: string): T {
    return this.$<T>(`[name=${name}]`);
  }

  private fill(s: Settings): void {
    this.field('newBusinessMonths').value = String(s.newBusinessMonths);
    this.field('activeDays').value = String(s.activeDays);
    this.field<HTMLTextAreaElement>('targetCategories').value = s.targetCategories.join('\n');
    this.field('placesApiKey').value = s.placesApiKey;
    this.field('delayMs').value = String(s.delayMs);
    this.field<HTMLSelectElement>('language').value = s.language;
    this.field('showBrowser').checked = s.showBrowser;
  }

  private read(prev: Settings): Settings {
    const num = (n: string, fallback: number) => {
      const v = Number(this.field(n).value);
      return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    return {
      ...prev,
      newBusinessMonths: num('newBusinessMonths', prev.newBusinessMonths),
      activeDays: num('activeDays', prev.activeDays),
      targetCategories: this.field<HTMLTextAreaElement>('targetCategories').value
        .split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      placesApiKey: this.field('placesApiKey').value.trim(),
      delayMs: num('delayMs', prev.delayMs),
      language: this.field<HTMLSelectElement>('language').value,
      showBrowser: this.field('showBrowser').checked,
    };
  }
}
customElements.define('settings-panel', SettingsPanel);
