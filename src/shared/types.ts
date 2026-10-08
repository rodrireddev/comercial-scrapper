// Tipos compartidos entre el proceso principal, el preload y el renderer.

export type Provider = 'browser' | 'places';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Zona a escanear, de una de tres formas:
 * - texto libre ("Palermo, Buenos Aires"),
 * - centro + radio con grilla N×N,
 * - rectángulo marcado en el mapa, dividido en celdas de `cellKm`.
 */
export interface ZoneSpec {
  label: string;
  text?: string;
  center?: LatLng;
  radiusKm?: number;
  /** Cantidad de celdas por lado de la grilla (1 = sin subdividir). */
  gridSize?: number;
  bounds?: Bounds;
  /** Lado de cada celda de búsqueda dentro de `bounds`, en km. */
  cellKm?: number;
}

export interface GeocodeResult {
  label: string;
  center: LatLng;
  bounds?: Bounds;
}

export interface MapsSessionStatus {
  loggedIn: boolean;
}

export interface ScanRequest {
  zones: ZoneSpec[];
  queries: string[];
  maxResultsPerQuery: number;
  provider: Provider;
  fetchReviews: boolean;
}

export interface Review {
  author?: string;
  rating?: number;
  text?: string;
  relativeDate?: string;
  /** Fecha ISO (exacta en Places API, estimada a partir de "hace 2 semanas" en el navegador). */
  date?: string;
}

/** Datos crudos que devuelve un proveedor para un lugar. */
export interface RawPlace {
  id: string;
  name: string;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  location?: LatLng;
  mapsUrl?: string;
  businessStatus?: 'operational' | 'closed_temporarily' | 'closed_permanently';
  /** Google marca el lugar como recién inaugurado. */
  recentlyOpenedLabel?: boolean;
  /** false si las reseñas obtenidas no están ordenadas por fecha (p. ej. vista limitada de Google sin sesión). */
  reviewsSortedByNewest?: boolean;
  reviews: Review[];
}

export interface Snapshot {
  at: string;
  rating?: number;
  reviewCount?: number;
  latestReviewDate?: string;
}

export type Activity = 'activo' | 'moderado' | 'inactivo' | 'cerrado' | 'desconocido';
export type LeadTier = 'alto' | 'medio' | 'bajo';
export type LeadStatus = 'pendiente' | 'contactado' | 'interesado' | 'cliente' | 'descartado';

export interface Classification {
  isNewBusiness: boolean;
  newBusinessReasons: string[];
  activity: Activity;
  latestReviewDate?: string;
  daysSinceLastReview?: number;
  newReviewsSinceLastScan: number;
  leadScore: number;
  leadTier: LeadTier;
  leadReasons: string[];
  opportunities: string[];
}

export interface Business extends RawPlace {
  zones: string[];
  queries: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  /** El lugar apareció por primera vez en una zona+búsqueda que ya se había escaneado antes. */
  appearedInRescan: boolean;
  history: Snapshot[];
  classification: Classification;
  leadStatus: LeadStatus;
  notes: string;
}

export interface ScanProgress {
  scanId: string;
  phase: 'searching' | 'details' | 'waiting-user' | 'done' | 'error' | 'cancelled';
  message: string;
  done: number;
  total: number;
  found: number;
}

export interface ScanRecord {
  id: string;
  startedAt: string;
  finishedAt?: string;
  request: ScanRequest;
  found: number;
  newBusinesses: number;
  status: 'running' | 'done' | 'error' | 'cancelled';
  error?: string;
}

export interface Settings {
  placesApiKey: string;
  /** Meses de antigüedad máxima para considerar un negocio "nuevo". */
  newBusinessMonths: number;
  /** Días desde la última reseña para considerar un negocio "activo". */
  activeDays: number;
  /** Rubros prioritarios para venta de soluciones informáticas. */
  targetCategories: string[];
  /** Mostrar la ventana del navegador mientras scrapea. */
  showBrowser: boolean;
  /** Pausa base entre páginas (ms), se le suma un jitter aleatorio. */
  delayMs: number;
  language: string;
}

export const DEFAULT_SETTINGS: Settings = {
  placesApiKey: '',
  newBusinessMonths: 6,
  activeDays: 60,
  targetCategories: [
    'restaurante', 'cafetería', 'bar', 'panadería', 'farmacia', 'ferretería', 'óptica',
    'clínica', 'consultorio', 'odontólogo', 'veterinaria', 'gimnasio', 'peluquería',
    'estética', 'inmobiliaria', 'taller', 'tienda', 'almacén', 'supermercado', 'hotel',
    'estudio contable', 'abogado', 'escuela', 'academia', 'lavandería', 'distribuidora',
  ],
  showBrowser: false,
  delayMs: 1500,
  language: 'es',
};

export interface BusinessPatch {
  leadStatus?: LeadStatus;
  notes?: string;
}

/** API expuesta al renderer por el preload (window.api). */
export interface RendererApi {
  startScan(req: ScanRequest): Promise<string>;
  cancelScan(): Promise<void>;
  isScanning(): Promise<boolean>;
  onScanProgress(cb: (p: ScanProgress) => void): () => void;
  onDataChanged(cb: () => void): () => void;
  listBusinesses(): Promise<Business[]>;
  updateBusiness(id: string, patch: BusinessPatch): Promise<Business | undefined>;
  deleteBusiness(id: string): Promise<void>;
  listScans(): Promise<ScanRecord[]>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<Settings>;
  exportCsv(ids: string[]): Promise<string | undefined>;
  openExternal(url: string): Promise<void>;
  /** Abre Google en la sesión del scraper para que el usuario inicie sesión. */
  openMapsLogin(): Promise<void>;
  logoutMaps(): Promise<void>;
  getMapsSession(): Promise<MapsSessionStatus>;
  onMapsSessionChanged(cb: (s: MapsSessionStatus) => void): () => void;
  geocode(query: string): Promise<GeocodeResult[]>;
}
