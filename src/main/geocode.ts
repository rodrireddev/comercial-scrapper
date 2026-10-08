import type { GeocodeResult } from '../shared/types';
import { geocodeWithMaps } from './scraper/maps-browser';

interface NominatimItem {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
}

/**
 * Busca una zona por nombre. Primero usa Nominatim (OpenStreetMap), que devuelve el área real del barrio o
 * ciudad; si no encuentra nada, cae a Google Maps (solo centro y un área aproximada).
 */
export async function geocode(query: string): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=es&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'comercial-scrapper/0.1 (desktop app)' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const items = (await res.json()) as NominatimItem[];
      const results = items.map((it) => {
        const [south, north, west, east] = (it.boundingbox ?? []).map(Number);
        return {
          label: it.display_name,
          center: { lat: Number(it.lat), lng: Number(it.lon) },
          bounds: it.boundingbox ? { south, north, west, east } : undefined,
        };
      });
      if (results.length) return results;
    }
  } catch {
    /* sin conexión con Nominatim: probar con Google */
  }
  const g = await geocodeWithMaps(q);
  return g ? [g] : [];
}
