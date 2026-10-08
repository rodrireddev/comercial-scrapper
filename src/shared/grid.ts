import type { Bounds, LatLng, ZoneSpec } from './types';

export interface SearchCell {
  zoneLabel: string;
  /** Texto agregado a la búsqueda ("en Palermo, Buenos Aires"). */
  text?: string;
  center?: LatLng;
  radiusM?: number;
}

const KM_PER_DEG_LAT = 110.574;
const kmPerDegLng = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

/**
 * Divide una zona en celdas para cubrir más superficie: Google limita los resultados por búsqueda
 * (~120 en Maps, 60 en Places API), así que una grilla encuentra más negocios en zonas densas.
 */
export function zoneToCells(zone: ZoneSpec): SearchCell[] {
  if (zone.bounds) return boundsToCells(zone.label, zone.bounds, zone.cellKm ?? 1);
  if (!zone.center) return [{ zoneLabel: zone.label, text: zone.text ?? zone.label }];

  const radiusKm = zone.radiusKm ?? 1;
  const n = Math.max(1, Math.min(10, Math.round(zone.gridSize ?? 1)));
  if (n === 1) return [{ zoneLabel: zone.label, center: zone.center, radiusM: radiusKm * 1000 }];

  const cellKm = (radiusKm * 2) / n;
  const cells: SearchCell[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dyKm = -radiusKm + cellKm * (i + 0.5);
      const dxKm = -radiusKm + cellKm * (j + 0.5);
      cells.push({
        zoneLabel: zone.label,
        center: {
          lat: zone.center.lat + dyKm / KM_PER_DEG_LAT,
          lng: zone.center.lng + dxKm / kmPerDegLng(zone.center.lat),
        },
        // Radio que circunscribe la celda cuadrada.
        radiusM: (cellKm / 2) * Math.SQRT2 * 1000,
      });
    }
  }
  return cells;
}

/**
 * Zoom de Google Maps para que el área visible del mapa (~900 px junto al panel de resultados) cubra el radio.
 * Google prioriza lo que está a la vista, así que un zoom demasiado bajo trae resultados de todo el barrio.
 */
export function radiusToZoom(radiusM: number, lat = 0): number {
  const metersPerPxAtZ0 = 156_543.03392 * Math.cos((lat * Math.PI) / 180);
  const zoom = Math.ceil(Math.log2((metersPerPxAtZ0 * 900) / (radiusM * 2)));
  return Math.max(12, Math.min(18, zoom));
}

/** Máximo de celdas por zona, para que un rectángulo enorme no dispare cientos de búsquedas. */
export const MAX_CELLS = 100;

export function boundsSizeKm(b: Bounds): { widthKm: number; heightKm: number } {
  const midLat = (b.north + b.south) / 2;
  return { widthKm: (b.east - b.west) * kmPerDegLng(midLat), heightKm: (b.north - b.south) * KM_PER_DEG_LAT };
}

/** Divide el rectángulo en una grilla de celdas de ~cellKm de lado (agranda las celdas si superan MAX_CELLS). */
export function boundsGrid(b: Bounds, cellKm: number): { rows: number; cols: number } {
  const { widthKm, heightKm } = boundsSizeKm(b);
  let size = Math.max(0.2, cellKm);
  let rows = Math.max(1, Math.ceil(heightKm / size));
  let cols = Math.max(1, Math.ceil(widthKm / size));
  while (rows * cols > MAX_CELLS) {
    size *= 1.15;
    rows = Math.max(1, Math.ceil(heightKm / size));
    cols = Math.max(1, Math.ceil(widthKm / size));
  }
  return { rows, cols };
}

function boundsToCells(label: string, b: Bounds, cellKm: number): SearchCell[] {
  const { rows, cols } = boundsGrid(b, cellKm);
  const { widthKm, heightKm } = boundsSizeKm(b);
  const dLat = (b.north - b.south) / rows;
  const dLng = (b.east - b.west) / cols;
  const radiusM = (Math.hypot(widthKm / cols, heightKm / rows) / 2) * 1000;
  const cells: SearchCell[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      cells.push({
        zoneLabel: label,
        center: { lat: b.south + dLat * (i + 0.5), lng: b.west + dLng * (j + 0.5) },
        radiusM,
      });
    }
  }
  return cells;
}

/**
 * Indica si un lugar cae dentro de la zona (con un margen pequeño). Google devuelve resultados cercanos
 * aunque estén fuera del área pedida; con esto se descartan. Las zonas de texto libre no se filtran.
 */
export function zoneContains(zone: ZoneSpec, loc: LatLng | undefined): boolean {
  if (!loc) return true;
  if (zone.bounds) {
    const b = zone.bounds;
    const mLat = (b.north - b.south) * 0.05;
    const mLng = (b.east - b.west) * 0.05;
    return loc.lat >= b.south - mLat && loc.lat <= b.north + mLat && loc.lng >= b.west - mLng && loc.lng <= b.east + mLng;
  }
  if (zone.center) {
    const dy = (loc.lat - zone.center.lat) * KM_PER_DEG_LAT;
    const dx = (loc.lng - zone.center.lng) * kmPerDegLng(zone.center.lat);
    return Math.hypot(dx, dy) <= (zone.radiusKm ?? 1) * 1.15;
  }
  return true;
}
