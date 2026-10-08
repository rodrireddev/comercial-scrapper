import type { Activity, Business, Classification, LeadTier, Review, Settings } from '../shared/types';
import { daysBetween } from './dates';

/** Dominios que indican que el negocio no tiene una web propia. */
const WEAK_WEBSITE_HOSTS = [
  'facebook.com', 'fb.com', 'instagram.com', 'linktr.ee', 'wa.me', 'whatsapp.com', 'tiktok.com',
  'wixsite.com', 'blogspot.com', 'sites.google.com', 'business.site', 'negocio.site', 'mercadoshops',
  'pedidosya.com', 'rappi.com', 'ubereats.com', 'linkin.bio', 'beacons.ai', 'carrd.co',
];

/** Palabras en reseñas que revelan dolores que una solución informática puede resolver. */
const PAIN_SIGNALS: Array<{ re: RegExp; opportunity: string }> = [
  { re: /\b(turnos?|reserva[rs]?|agenda|cita)\b/i, opportunity: 'Sistema de turnos / reservas online' },
  { re: /\b(pedidos?|delivery|env[ií]o|para llevar)\b/i, opportunity: 'Pedidos online / integración delivery' },
  { re: /\b(tarjeta|d[eé]bito|cr[eé]dito|mercado ?pago|transferencia|s[oó]lo efectivo)\b/i, opportunity: 'Medios de pago / POS' },
  { re: /\b(factura|ticket|comprobante)\b/i, opportunity: 'Facturación electrónica' },
  { re: /\b(espera|demora|lent[oa]s?|cola|tardaron)\b/i, opportunity: 'Gestión de colas / operación' },
  { re: /\b(no atiende[nr]?|tel[eé]fono|whats ?app|no contestan|no responden)\b/i, opportunity: 'Atención digital / chatbot WhatsApp' },
  { re: /\b(stock|no ten[ií]an|faltante|precio[s]? (distinto|diferente))\b/i, opportunity: 'Control de stock e inventario' },
  { re: /\b(wifi|wi-fi|internet)\b/i, opportunity: 'Infraestructura de red / WiFi' },
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function latestReviewDate(reviews: Review[]): string | undefined {
  return reviews
    .map((r) => r.date)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
}

function oldestReviewDate(reviews: Review[]): string | undefined {
  return reviews
    .map((r) => r.date)
    .filter((d): d is string => !!d)
    .sort()[0];
}

function matchesTarget(category: string | undefined, name: string, targets: string[]): string | undefined {
  const hay = `${category ?? ''} ${name}`.toLowerCase();
  return targets.find((t) => t.trim() && hay.includes(t.trim().toLowerCase()));
}

export function classify(b: Business, settings: Settings, now: Date = new Date()): Classification {
  // ---------- Negocio nuevo ----------
  const newBusinessReasons: string[] = [];
  let newScore = 0;
  const reviewCount = b.reviewCount ?? 0;
  const oldest = oldestReviewDate(b.reviews);
  const maxNewDays = settings.newBusinessMonths * 30;

  if (b.recentlyOpenedLabel) {
    newScore += 3;
    newBusinessReasons.push('Google lo marca como recién inaugurado');
  }
  // Un lugar con muchas reseñas que "aparece" en un re-escaneo seguramente quedó fuera del límite de
  // resultados la vez anterior; solo cuenta como señal si tiene pocas reseñas.
  if (b.appearedInRescan && reviewCount <= 30) {
    newScore += 2;
    newBusinessReasons.push(`Apareció en un re-escaneo de la zona (visto por primera vez ${b.firstSeenAt.slice(0, 10)})`);
  }
  // Solo podemos confiar en la reseña más antigua si tenemos (casi) todas las reseñas del lugar.
  if (oldest && reviewCount > 0 && b.reviews.length >= reviewCount && daysBetween(oldest, now) <= maxNewDays) {
    newScore += 2;
    newBusinessReasons.push(`Su primera reseña es de hace ${daysBetween(oldest, now)} días`);
  }
  if (reviewCount === 0) {
    newScore += 1;
    newBusinessReasons.push('Todavía no tiene reseñas');
  } else if (reviewCount <= 10) {
    newScore += 1;
    newBusinessReasons.push(`Pocas reseñas (${reviewCount})`);
  }
  const isNewBusiness = newScore >= 2 && b.businessStatus !== 'closed_permanently';

  // ---------- Actividad ----------
  const latest = latestReviewDate(b.reviews);
  const daysSinceLastReview = latest ? daysBetween(latest, now) : undefined;
  const prev = b.history.at(-2);
  const curr = b.history.at(-1);
  const newReviewsSinceLastScan =
    prev?.reviewCount !== undefined && curr?.reviewCount !== undefined
      ? Math.max(0, curr.reviewCount - prev.reviewCount)
      : 0;

  let activity: Activity;
  if (b.businessStatus === 'closed_permanently') activity = 'cerrado';
  else if (daysSinceLastReview !== undefined && daysSinceLastReview <= settings.activeDays) activity = 'activo';
  else if (newReviewsSinceLastScan > 0) activity = 'activo';
  // Reseñas sin ordenar por fecha (vista limitada de Google): que no aparezcan recientes no prueba inactividad.
  else if (b.reviewsSortedByNewest === false) activity = 'desconocido';
  else if (daysSinceLastReview !== undefined && daysSinceLastReview <= settings.activeDays * 3) activity = 'moderado';
  else if (daysSinceLastReview !== undefined) activity = 'inactivo';
  else activity = 'desconocido';

  // ---------- Potencial cliente ----------
  const leadReasons: string[] = [];
  const opportunities = new Set<string>();
  let score = 20;

  if (activity === 'cerrado' || b.businessStatus === 'closed_temporarily') {
    return {
      isNewBusiness, newBusinessReasons, activity, latestReviewDate: latest, daysSinceLastReview,
      newReviewsSinceLastScan, leadScore: 0, leadTier: 'bajo',
      leadReasons: [b.businessStatus === 'closed_temporarily' ? 'Cerrado temporalmente' : 'Cerrado permanentemente'],
      opportunities: [],
    };
  }

  if (!b.website) {
    score += 25;
    leadReasons.push('No tiene sitio web');
    opportunities.add('Sitio web / landing page');
  } else {
    const host = hostOf(b.website);
    if (WEAK_WEBSITE_HOSTS.some((h) => host.includes(h))) {
      score += 15;
      leadReasons.push(`Su "web" es una red social o constructor gratuito (${host})`);
      opportunities.add('Sitio web propio con dominio');
    }
  }

  if (b.phone) {
    score += 5;
    leadReasons.push('Contactable por teléfono');
  } else {
    score -= 5;
    leadReasons.push('Sin teléfono publicado (más difícil de contactar)');
  }

  if (activity === 'activo') {
    score += 15;
    leadReasons.push('Negocio activo (reseñas recientes)');
  } else if (activity === 'moderado') {
    score += 5;
  } else if (activity === 'inactivo') {
    score -= 15;
    leadReasons.push('Sin reseñas recientes: puede estar inactivo');
  }

  if (isNewBusiness) {
    score += 15;
    leadReasons.push('Negocio nuevo: suele necesitar sistemas de gestión, POS y presencia online');
    opportunities.add('Kit de apertura: POS, facturación y web');
  }

  const target = matchesTarget(b.category, b.name, settings.targetCategories);
  if (target) {
    score += 10;
    leadReasons.push(`Rubro prioritario (${target})`);
  }

  if (reviewCount > 1500) {
    score -= 20;
    leadReasons.push('Muy grande o cadena: probablemente ya tiene área de sistemas');
  } else if (reviewCount >= 15 && reviewCount <= 500) {
    score += 5;
    leadReasons.push('Tamaño PyME con clientela establecida');
  }

  const painHits = new Set<string>();
  for (const r of b.reviews) {
    if (!r.text) continue;
    for (const p of PAIN_SIGNALS) {
      if (p.re.test(r.text)) {
        painHits.add(p.opportunity);
        opportunities.add(p.opportunity);
      }
    }
  }
  if (painHits.size > 0) {
    score += Math.min(15, painHits.size * 5);
    leadReasons.push(`Reseñas mencionan problemas operativos (${[...painHits].join(', ')})`);
  }

  if (b.rating !== undefined && b.rating < 4 && reviewCount >= 5) {
    score += 5;
    leadReasons.push(`Calificación mejorable (${b.rating.toFixed(1)})`);
    opportunities.add('Gestión de reputación / encuestas post-venta');
  }

  const leadScore = Math.max(0, Math.min(100, Math.round(score)));
  const leadTier: LeadTier = leadScore >= 60 ? 'alto' : leadScore >= 40 ? 'medio' : 'bajo';

  return {
    isNewBusiness, newBusinessReasons, activity, latestReviewDate: latest, daysSinceLastReview,
    newReviewsSinceLastScan, leadScore, leadTier, leadReasons, opportunities: [...opportunities],
  };
}
