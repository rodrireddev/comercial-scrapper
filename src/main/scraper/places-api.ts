import type { RawPlace, Review } from '../../shared/types';
import type { SearchCell } from '../../shared/grid';
import { politeDelay, throwIfAborted, type PlaceProvider, type PlaceRef, type ProviderContext } from './provider';

// Proveedor basado en la API oficial Google Places (New): estable y dentro de los términos de uso.
// https://developers.google.com/maps/documentation/places/web-service/text-search

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

const BASE_FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.rating',
  'places.userRatingCount', 'places.websiteUri', 'places.nationalPhoneNumber',
  'places.internationalPhoneNumber', 'places.primaryTypeDisplayName', 'places.googleMapsUri',
  'places.businessStatus', 'nextPageToken',
];

interface ApiReview {
  rating?: number;
  text?: { text?: string };
  originalText?: { text?: string };
  relativePublishTimeDescription?: string;
  publishTime?: string;
  authorAttribution?: { displayName?: string };
}

interface ApiPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  primaryTypeDisplayName?: { text?: string };
  googleMapsUri?: string;
  businessStatus?: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';
  reviews?: ApiReview[];
}

const STATUS_MAP = {
  OPERATIONAL: 'operational',
  CLOSED_TEMPORARILY: 'closed_temporarily',
  CLOSED_PERMANENTLY: 'closed_permanently',
} as const;

function toRawPlace(p: ApiPlace): RawPlace {
  const reviews: Review[] = (p.reviews ?? []).map((r) => ({
    author: r.authorAttribution?.displayName,
    rating: r.rating,
    text: r.originalText?.text ?? r.text?.text,
    relativeDate: r.relativePublishTimeDescription,
    date: r.publishTime,
  }));
  return {
    id: `places:${p.id}`,
    name: p.displayName?.text ?? '(sin nombre)',
    category: p.primaryTypeDisplayName?.text,
    address: p.formattedAddress,
    phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber,
    website: p.websiteUri,
    rating: p.rating,
    reviewCount: p.userRatingCount ?? 0,
    location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : undefined,
    mapsUrl: p.googleMapsUri,
    businessStatus: p.businessStatus ? STATUS_MAP[p.businessStatus] : undefined,
    reviews,
  };
}

export class PlacesApiProvider implements PlaceProvider {
  async search(cell: SearchCell, query: string, max: number, ctx: ProviderContext): Promise<PlaceRef[]> {
    const key = ctx.settings.placesApiKey.trim();
    if (!key) throw new Error('Falta la API key de Google Places (Configuración).');

    const fields = [...BASE_FIELDS, ...(ctx.fetchReviews ? ['places.reviews'] : [])].join(',');
    const refs: PlaceRef[] = [];
    let pageToken: string | undefined;

    do {
      throwIfAborted(ctx.signal);
      const body: Record<string, unknown> = {
        textQuery: cell.text ? `${query} en ${cell.text}` : query,
        languageCode: ctx.settings.language,
        pageSize: Math.min(20, max - refs.length),
      };
      if (cell.center) {
        body.locationBias = {
          circle: {
            center: { latitude: cell.center.lat, longitude: cell.center.lng },
            radius: Math.min(50_000, cell.radiusM ?? 1000),
          },
        };
      }
      if (pageToken) body.pageToken = pageToken;

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': fields,
        },
        body: JSON.stringify(body),
        signal: ctx.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Places API respondió ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as { places?: ApiPlace[]; nextPageToken?: string };
      for (const p of json.places ?? []) {
        const full = toRawPlace(p);
        refs.push({ id: full.id, name: full.name, url: full.mapsUrl, location: full.location, full });
      }
      ctx.log(`Places API: ${refs.length} resultados para "${query}" en ${cell.zoneLabel}`);
      pageToken = json.nextPageToken;
      if (pageToken) await politeDelay(ctx, 0.5);
    } while (pageToken && refs.length < max);

    return refs.slice(0, max);
  }

  async details(ref: PlaceRef): Promise<RawPlace | undefined> {
    return ref.full;
  }

  dispose(): void {}
}
