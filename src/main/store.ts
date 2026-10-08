import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SETTINGS,
  type Business,
  type BusinessPatch,
  type RawPlace,
  type Review,
  type ScanRecord,
  type Settings,
} from '../shared/types';
import { classify } from './classifier';

interface DbShape {
  version: 1;
  businesses: Record<string, Business>;
  scans: ScanRecord[];
  /** Combinaciones zona+búsqueda ya escaneadas → fecha del primer escaneo. */
  combos: Record<string, string>;
  settings: Settings;
}

const MAX_HISTORY = 60;
const MAX_REVIEWS = 40;
const MAX_SCANS = 200;

function reviewKey(r: Review): string {
  return `${r.author ?? ''}|${(r.text ?? '').slice(0, 80)}|${r.rating ?? ''}`;
}

export function comboKey(zone: string, query: string): string {
  return `${zone.trim().toLowerCase()}::${query.trim().toLowerCase()}`;
}

/** Base de datos JSON simple en la carpeta de datos del usuario, con escritura atómica diferida. */
export class Store {
  private db: DbShape;
  private saveTimer: NodeJS.Timeout | undefined;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {
    this.db = this.load();
  }

  private load(): DbShape {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as DbShape;
      return {
        version: 1,
        businesses: parsed.businesses ?? {},
        scans: parsed.scans ?? [],
        combos: parsed.combos ?? {},
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      };
    } catch {
      return { version: 1, businesses: {}, scans: [], combos: {}, settings: { ...DEFAULT_SETTINGS } };
    }
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 400);
  }

  async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    const data = JSON.stringify(this.db);
    this.saving = this.saving.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, data, 'utf8');
      await fs.rename(tmp, this.file);
    });
    return this.saving;
  }

  // ---------- Settings ----------
  get settings(): Settings {
    return this.db.settings;
  }

  saveSettings(s: Settings): Settings {
    this.db.settings = { ...DEFAULT_SETTINGS, ...s };
    this.reclassifyAll();
    return this.db.settings;
  }

  // ---------- Combos ----------
  wasComboScanned(zone: string, query: string): boolean {
    return comboKey(zone, query) in this.db.combos;
  }

  markComboScanned(zone: string, query: string, at: string): void {
    this.db.combos[comboKey(zone, query)] ??= at;
    this.scheduleSave();
  }

  // ---------- Businesses ----------
  listBusinesses(): Business[] {
    return Object.values(this.db.businesses);
  }

  getBusiness(id: string): Business | undefined {
    return this.db.businesses[id];
  }

  /**
   * Inserta o actualiza un lugar encontrado en un escaneo y lo reclasifica.
   * `comboPreviouslyScanned` indica si la zona+búsqueda ya se había escaneado antes de este escaneo.
   */
  upsert(raw: RawPlace, ctx: { zone: string; query: string; at: string; comboPreviouslyScanned: boolean }): {
    business: Business;
    isNew: boolean;
  } {
    const existing = this.db.businesses[raw.id];
    let b: Business;

    if (!existing) {
      b = {
        ...raw,
        zones: [ctx.zone],
        queries: [ctx.query],
        firstSeenAt: ctx.at,
        lastSeenAt: ctx.at,
        appearedInRescan: ctx.comboPreviouslyScanned,
        history: [],
        classification: undefined as never,
        leadStatus: 'pendiente',
        notes: '',
      };
    } else {
      const reviews = new Map(existing.reviews.map((r) => [reviewKey(r), r]));
      for (const r of raw.reviews) reviews.set(reviewKey(r), r);
      b = {
        ...existing,
        ...stripUndefined(raw),
        reviews: [...reviews.values()].sort((a, c) => (c.date ?? '').localeCompare(a.date ?? '')).slice(0, MAX_REVIEWS),
        zones: uniq([...existing.zones, ctx.zone]),
        queries: uniq([...existing.queries, ctx.query]),
        lastSeenAt: ctx.at,
      };
    }

    const latestReviewDate = b.reviews.map((r) => r.date).filter(Boolean).sort().at(-1);
    const last = b.history.at(-1);
    // Un snapshot por escaneo (si el lugar aparece en varias búsquedas del mismo escaneo, se actualiza).
    const snap = { at: ctx.at, rating: b.rating, reviewCount: b.reviewCount, latestReviewDate };
    if (last && last.at === ctx.at) b.history[b.history.length - 1] = snap;
    else b.history = [...b.history, snap].slice(-MAX_HISTORY);

    b.classification = classify(b, this.db.settings);
    this.db.businesses[b.id] = b;
    this.scheduleSave();
    return { business: b, isNew: !existing };
  }

  updateBusiness(id: string, patch: BusinessPatch): Business | undefined {
    const b = this.db.businesses[id];
    if (!b) return undefined;
    if (patch.leadStatus) b.leadStatus = patch.leadStatus;
    if (patch.notes !== undefined) b.notes = patch.notes;
    this.scheduleSave();
    return b;
  }

  deleteBusiness(id: string): void {
    delete this.db.businesses[id];
    this.scheduleSave();
  }

  reclassifyAll(): void {
    for (const b of Object.values(this.db.businesses)) b.classification = classify(b, this.db.settings);
    this.scheduleSave();
  }

  // ---------- Scans ----------
  listScans(): ScanRecord[] {
    return [...this.db.scans].reverse();
  }

  addScan(s: ScanRecord): void {
    this.db.scans = [...this.db.scans, s].slice(-MAX_SCANS);
    this.scheduleSave();
  }

  updateScan(id: string, patch: Partial<ScanRecord>): void {
    const s = this.db.scans.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
    this.scheduleSave();
  }
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))) as Partial<T>;
}
