import type { Activity, Business, LeadStatus, LeadTier } from '../shared/types';
import { api } from './base';

export type SortKey = 'score' | 'name' | 'rating' | 'reviews' | 'lastReview' | 'firstSeen';

export interface Filters {
  text: string;
  tier: LeadTier | '';
  activity: Activity | '';
  leadStatus: LeadStatus | '';
  zone: string;
  onlyNew: boolean;
  noWebsite: boolean;
  sort: SortKey;
  desc: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  text: '', tier: '', activity: '', leadStatus: '', zone: '', onlyNew: false, noWebsite: false, sort: 'score', desc: true,
};

const SORTERS: Record<SortKey, (b: Business) => string | number> = {
  score: (b) => b.classification.leadScore,
  name: (b) => b.name.toLowerCase(),
  rating: (b) => b.rating ?? -1,
  reviews: (b) => b.reviewCount ?? -1,
  lastReview: (b) => b.classification.latestReviewDate ?? '',
  firstSeen: (b) => b.firstSeenAt,
};

/** Estado global del renderer. Los componentes escuchan el evento "change". */
class AppState extends EventTarget {
  businesses: Business[] = [];
  filters: Filters = { ...DEFAULT_FILTERS };
  selectedId: string | undefined;

  async refresh(): Promise<void> {
    this.businesses = await api().listBusinesses();
    this.changed();
  }

  get selected(): Business | undefined {
    return this.businesses.find((b) => b.id === this.selectedId);
  }

  get zones(): string[] {
    return [...new Set(this.businesses.flatMap((b) => b.zones))].sort();
  }

  get filtered(): Business[] {
    const f = this.filters;
    const text = f.text.trim().toLowerCase();
    const rows = this.businesses.filter((b) => {
      const c = b.classification;
      if (f.tier && c.leadTier !== f.tier) return false;
      if (f.activity && c.activity !== f.activity) return false;
      if (f.leadStatus && b.leadStatus !== f.leadStatus) return false;
      if (f.zone && !b.zones.includes(f.zone)) return false;
      if (f.onlyNew && !c.isNewBusiness) return false;
      if (f.noWebsite && b.website) return false;
      if (text && !`${b.name} ${b.category ?? ''} ${b.address ?? ''} ${b.notes}`.toLowerCase().includes(text)) return false;
      return true;
    });
    const key = SORTERS[f.sort];
    const dir = f.desc ? -1 : 1;
    return rows.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }

  setFilters(patch: Partial<Filters>): void {
    this.filters = { ...this.filters, ...patch };
    this.changed();
  }

  select(id: string | undefined): void {
    this.selectedId = id;
    this.changed();
  }

  replace(b: Business): void {
    this.businesses = this.businesses.map((x) => (x.id === b.id ? b : x));
    this.changed();
  }

  remove(id: string): void {
    this.businesses = this.businesses.filter((x) => x.id !== id);
    if (this.selectedId === id) this.selectedId = undefined;
    this.changed();
  }

  private changed(): void {
    this.dispatchEvent(new Event('change'));
  }
}

export const state = new AppState();
