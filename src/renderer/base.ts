// Utilidades mínimas para Web Components: template con escape automático y estilos compartidos.

import type { RendererApi } from '../shared/types';

declare global {
  interface Window {
    api: RendererApi;
  }
}

export const api = (): RendererApi => window.api;

export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function interpolate(v: unknown): string {
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(interpolate).join('');
  if (v === undefined || v === null || v === false) return '';
  return esc(v);
}

/** Template HTML: todo valor interpolado se escapa salvo que sea otro `html`. Los datos scrapeados nunca se insertan crudos. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += interpolate(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

export function sheet(cssText: string): CSSStyleSheet {
  const s = new CSSStyleSheet();
  s.replaceSync(cssText);
  return s;
}

const shared = sheet(`
  :host { display: block; color: var(--fg); font: 13px/1.45 var(--font); box-sizing: border-box; }
  *, *::before, *::after { box-sizing: inherit; }
  h2, h3, h4 { margin: 0 0 8px; font-weight: 600; }
  h2 { font-size: 16px; } h3 { font-size: 14px; } h4 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  button {
    font: inherit; color: var(--fg); background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 12px; cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--accent); }
  button:disabled { opacity: .5; cursor: default; }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 600; }
  button.danger { color: var(--danger); }
  button.link { background: none; border: none; color: var(--accent); padding: 0; text-decoration: underline; }
  input, select, textarea {
    font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 8px; width: 100%;
  }
  input[type=checkbox] { width: auto; }
  input:focus, select:focus, textarea:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
  textarea { resize: vertical; font-family: var(--mono); font-size: 12px; }
  label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
  label.inline { display: flex; align-items: center; gap: 6px; color: var(--fg); font-size: 13px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .muted { color: var(--muted); }
  .row { display: flex; gap: 8px; align-items: center; }
  .chip {
    display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 600; white-space: nowrap; border: 1px solid transparent;
  }
  .chip.alto, .chip.activo, .chip.nuevo, .chip.cliente { background: var(--ok-bg); color: var(--ok); }
  .chip.medio, .chip.moderado, .chip.interesado, .chip.contactado { background: var(--warn-bg); color: var(--warn); }
  .chip.bajo, .chip.inactivo, .chip.cerrado, .chip.descartado { background: var(--bad-bg); color: var(--danger); }
  .chip.desconocido, .chip.pendiente, .chip.neutral { background: var(--surface-2); color: var(--muted); border-color: var(--border); }
`);

export abstract class BaseElement extends HTMLElement {
  static styles: CSSStyleSheet | undefined;
  protected readonly root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    const own = (this.constructor as typeof BaseElement).styles;
    this.root.adoptedStyleSheets = own ? [shared, own] : [shared];
  }

  connectedCallback(): void {
    this.render();
  }

  protected abstract template(): SafeHtml;

  protected render(): void {
    this.root.innerHTML = this.template().value;
    this.afterRender();
  }

  protected afterRender(): void {}

  protected $<T extends Element = HTMLElement>(sel: string): T {
    const el = this.root.querySelector<T>(sel);
    if (!el) throw new Error(`${this.localName}: no existe ${sel}`);
    return el;
  }

  protected $$<T extends Element = HTMLElement>(sel: string): T[] {
    return Array.from(this.root.querySelectorAll<T>(sel));
  }
}

export function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function daysAgo(days: number | undefined): string {
  if (days === undefined) return '—';
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} d`;
  if (days < 365) return `hace ${Math.round(days / 30)} m`;
  return `hace ${(days / 365).toFixed(1)} a`;
}
