import { randomUUID } from 'node:crypto';
import type { ScanProgress, ScanRequest } from '../shared/types';
import { zoneContains, zoneToCells } from '../shared/grid';
import { MapsBrowserProvider } from './scraper/maps-browser';
import { PlacesApiProvider } from './scraper/places-api';
import { CancelledError, type PlaceProvider, type PlaceRef, type ProviderContext } from './scraper/provider';
import type { Store } from './store';

interface Job {
  ref: PlaceRef;
  zone: string;
  query: string;
  comboPreviouslyScanned: boolean;
}

/** Orquesta un escaneo: zonas × búsquedas → celdas → resultados → detalle → clasificación. */
export class Scanner {
  private abort: AbortController | undefined;

  constructor(
    private readonly store: Store,
    private readonly emit: (p: ScanProgress) => void,
    private readonly onData: () => void,
  ) {}

  get running(): boolean {
    return !!this.abort;
  }

  cancel(): void {
    this.abort?.abort();
  }

  start(req: ScanRequest): string {
    if (this.abort) throw new Error('Ya hay un escaneo en curso.');
    const scanId = randomUUID();
    this.abort = new AbortController();
    void this.run(scanId, req, this.abort.signal).finally(() => {
      this.abort = undefined;
    });
    return scanId;
  }

  private async run(scanId: string, req: ScanRequest, signal: AbortSignal): Promise<void> {
    const startedAt = new Date().toISOString();
    this.store.addScan({ id: scanId, startedAt, request: req, found: 0, newBusinesses: 0, status: 'running' });

    let done = 0;
    let total = 0;
    let found = 0;
    let newBusinesses = 0;
    const progress = (phase: ScanProgress['phase'], message: string) =>
      this.emit({ scanId, phase, message, done, total, found });

    const ctx: ProviderContext = {
      settings: this.store.settings,
      fetchReviews: req.fetchReviews,
      signal,
      log: (m) => progress(done === 0 && total === 0 ? 'searching' : 'details', m),
      waitingUser: (m) => progress('waiting-user', m),
    };
    const provider: PlaceProvider = req.provider === 'places' ? new PlacesApiProvider() : new MapsBrowserProvider();
    // Al detener, cerrar la ventana del navegador de inmediato en lugar de esperar a que termine la página actual.
    signal.addEventListener('abort', () => provider.dispose(), { once: true });

    try {
      // 1) Búsqueda: juntar referencias únicas de todas las zonas/búsquedas.
      const jobs = new Map<string, Job>();
      const combosToMark: Array<[string, string]> = [];
      const cellsTotal = req.zones.reduce((n, z) => n + zoneToCells(z).length, 0) * req.queries.length;
      let cellsDone = 0;

      for (const zone of req.zones) {
        for (const query of req.queries) {
          const comboPreviouslyScanned = this.store.wasComboScanned(zone.label, query);
          for (const cell of zoneToCells(zone)) {
            cellsDone++;
            progress('searching', `Búsqueda ${cellsDone}/${cellsTotal}: "${query}" en ${cell.zoneLabel}`);
            const refs = await provider.search(cell, query, req.maxResultsPerQuery, ctx);
            let outside = 0;
            for (const ref of refs) {
              if (!zoneContains(zone, ref.location)) {
                outside++;
                continue;
              }
              if (!jobs.has(ref.id)) jobs.set(ref.id, { ref, zone: zone.label, query, comboPreviouslyScanned });
            }
            if (outside) progress('searching', `${outside} resultados fuera de la zona descartados`);
          }
          combosToMark.push([zone.label, query]);
        }
      }

      // 2) Detalle + clasificación de cada lugar.
      total = jobs.size;
      progress('details', `${total} lugares únicos encontrados. Obteniendo detalles…`);
      for (const job of jobs.values()) {
        try {
          const raw = await provider.details(job.ref, ctx);
          if (raw) {
            const { business, isNew } = this.store.upsert(raw, {
              zone: job.zone,
              query: job.query,
              at: startedAt,
              comboPreviouslyScanned: job.comboPreviouslyScanned,
            });
            found++;
            if (isNew) newBusinesses++;
            done++;
            progress('details', `${business.name} — ${business.classification.leadTier} (${business.classification.leadScore})`);
            if (done % 5 === 0) this.onData();
            continue;
          }
        } catch (err) {
          if (err instanceof CancelledError) throw err;
          // Un bloqueo/captcha corta todo el escaneo; otros errores solo saltean el lugar.
          if (/captcha|tráfico inusual/i.test(String(err))) throw err;
          progress('details', `Error con ${job.ref.name ?? job.ref.id}: ${(err as Error).message}`);
        }
        done++;
      }

      // Las combinaciones se marcan al final para que dentro de un mismo escaneo no cuenten como re-escaneo.
      for (const [z, q] of combosToMark) this.store.markComboScanned(z, q, startedAt);
      this.store.updateScan(scanId, { finishedAt: new Date().toISOString(), found, newBusinesses, status: 'done' });
      progress('done', `Escaneo terminado: ${found} lugares (${newBusinesses} nuevos en la base).`);
    } catch (err) {
      const cancelled = err instanceof CancelledError || signal.aborted;
      this.store.updateScan(scanId, {
        finishedAt: new Date().toISOString(),
        found,
        newBusinesses,
        status: cancelled ? 'cancelled' : 'error',
        error: cancelled ? undefined : (err as Error).message,
      });
      progress(cancelled ? 'cancelled' : 'error', cancelled ? 'Escaneo cancelado.' : `Error: ${(err as Error).message}`);
    } finally {
      provider.dispose();
      await this.store.flush();
      this.onData();
    }
  }
}
