import type { LatLng, RawPlace, Settings } from '../../shared/types';
import type { SearchCell } from '../../shared/grid';

export interface PlaceRef {
  id: string;
  url?: string;
  name?: string;
  /** Ubicación conocida desde la búsqueda, para descartar lugares fuera de la zona antes de abrirlos. */
  location?: LatLng;
  /** Si el proveedor ya devolvió todos los datos en la búsqueda (Places API). */
  full?: RawPlace;
}

export interface ProviderContext {
  settings: Settings;
  fetchReviews: boolean;
  signal: AbortSignal;
  log(message: string): void;
  /** Avisa que el usuario tiene que intervenir (p. ej. aceptar cookies de Google). */
  waitingUser(message: string): void;
}

export interface PlaceProvider {
  search(cell: SearchCell, query: string, max: number, ctx: ProviderContext): Promise<PlaceRef[]>;
  details(ref: PlaceRef, ctx: ProviderContext): Promise<RawPlace | undefined>;
  dispose(): void;
}

export class CancelledError extends Error {
  constructor() {
    super('Escaneo cancelado');
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new CancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Pausa con jitter para no golpear a Google con un patrón fijo. */
export function politeDelay(ctx: ProviderContext, factor = 1): Promise<void> {
  const base = ctx.settings.delayMs * factor;
  return sleep(base + Math.random() * base * 0.6, ctx.signal);
}

/** Rechaza con CancelledError apenas se cancela, sin esperar a que termine la operación en curso. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new CancelledError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new CancelledError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(signal.aborted ? new CancelledError() : e);
      },
    );
  });
}
