import type { Business } from '../shared/types';

const COLUMNS: Array<[string, (b: Business) => unknown]> = [
  ['Nombre', (b) => b.name],
  ['Rubro', (b) => b.category],
  ['Dirección', (b) => b.address],
  ['Teléfono', (b) => b.phone],
  ['Sitio web', (b) => b.website],
  ['Calificación', (b) => b.rating],
  ['Reseñas', (b) => b.reviewCount],
  ['Puntaje lead', (b) => b.classification.leadScore],
  ['Nivel lead', (b) => b.classification.leadTier],
  ['Negocio nuevo', (b) => (b.classification.isNewBusiness ? 'sí' : 'no')],
  ['Actividad', (b) => b.classification.activity],
  ['Última reseña', (b) => b.classification.latestReviewDate?.slice(0, 10)],
  ['Reseñas nuevas desde último escaneo', (b) => b.classification.newReviewsSinceLastScan],
  ['Oportunidades', (b) => b.classification.opportunities.join('; ')],
  ['Motivos', (b) => b.classification.leadReasons.join('; ')],
  ['Estado comercial', (b) => b.leadStatus],
  ['Notas', (b) => b.notes],
  ['Zonas', (b) => b.zones.join('; ')],
  ['Búsquedas', (b) => b.queries.join('; ')],
  ['Visto por primera vez', (b) => b.firstSeenAt.slice(0, 10)],
  ['Latitud', (b) => b.location?.lat],
  ['Longitud', (b) => b.location?.lng],
  ['Google Maps', (b) => b.mapsUrl],
];

function cell(v: unknown): string {
  if (v === undefined || v === null) return '';
  let s = String(v);
  // Evita inyección de fórmulas al abrir el CSV en Excel.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV separado por ";" con BOM, para que Excel en español lo abra bien. */
export function toCsv(rows: Business[]): string {
  const lines = [COLUMNS.map(([h]) => cell(h)).join(';')];
  for (const b of rows) lines.push(COLUMNS.map(([, get]) => cell(get(b))).join(';'));
  return '﻿' + lines.join('\r\n');
}
