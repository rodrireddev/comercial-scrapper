import type { ZoneSpec } from '../shared/types';

const COORDS = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

const BOUNDS = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*;\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/**
 * Interpreta una zona por línea:
 *   Palermo, Buenos Aires                                   → búsqueda por texto
 *   -34.5885,-58.4305                                       → centro, radio 1 km
 *   Centro Córdoba | -31.4167,-64.1833 | 2 | 3              → nombre | centro | radio km | grilla NxN
 *   Palermo | -34.595,-58.445 ; -34.565,-58.400 | 1         → nombre | esquina SO ; esquina NE | celda km
 *                                                             (formato que genera el selector de mapa)
 */
export function parseZones(input: string): { zones: ZoneSpec[]; errors: string[] } {
  const zones: ZoneSpec[] = [];
  const errors: string[] = [];

  input.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;

    const parts = line.split('|').map((p) => p.trim());
    if (parts.length === 1) {
      const m = line.match(COORDS);
      if (m) zones.push({ label: line, center: { lat: Number(m[1]), lng: Number(m[2]) }, radiusKm: 1, gridSize: 1 });
      else zones.push({ label: line, text: line });
      return;
    }

    const [label, coords, radius, grid] = parts;
    const bm = coords?.match(BOUNDS);
    if (label && bm) {
      const [south, west, north, east] = bm.slice(1, 5).map(Number);
      const cellKm = radius ? Number(radius) : 1;
      if (!(north > south && east > west)) {
        errors.push(`Línea ${i + 1}: la primera esquina debe ser la suroeste y la segunda la noreste`);
      } else if (!(cellKm >= 0.2 && cellKm <= 20)) {
        errors.push(`Línea ${i + 1}: el tamaño de celda debe estar entre 0.2 y 20 km`);
      } else {
        zones.push({ label, bounds: { south, west, north, east }, cellKm });
      }
      return;
    }
    const m = coords?.match(COORDS);
    if (!label || !m) {
      errors.push(`Línea ${i + 1}: formato esperado "nombre | lat,lng | radio km | grilla"`);
      return;
    }
    const radiusKm = radius ? Number(radius) : 1;
    const gridSize = grid ? Number(grid) : 1;
    if (!(radiusKm > 0 && radiusKm <= 50) || !(gridSize >= 1 && gridSize <= 10)) {
      errors.push(`Línea ${i + 1}: radio entre 0 y 50 km y grilla entre 1 y 10`);
      return;
    }
    zones.push({ label, center: { lat: Number(m[1]), lng: Number(m[2]) }, radiusKm, gridSize: Math.round(gridSize) });
  });

  return { zones, errors };
}

/** Línea de texto para una zona marcada en el mapa (inverso de parseZones). */
export function formatBoundsZone(z: ZoneSpec): string {
  const b = z.bounds!;
  const f = (n: number) => n.toFixed(5);
  return `${z.label.replace(/\|/g, ' ')} | ${f(b.south)},${f(b.west)} ; ${f(b.north)},${f(b.east)} | ${z.cellKm ?? 1}`;
}
