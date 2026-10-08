// Conversión de fechas relativas de Google Maps ("hace 2 semanas", "a month ago") a fechas aproximadas.

const UNIT_DAYS: Array<[RegExp, number]> = [
  [/^(minuto|minute|min)/, 1 / 1440],
  [/^(hora|hour)/, 1 / 24],
  [/^(d[ií]a|day)/, 1],
  [/^(semana|week)/, 7],
  [/^(mes|month)/, 30],
  [/^(a[nñ]o|year)/, 365],
];

const WORD_NUMBERS: Record<string, number> = {
  un: 1, una: 1, uno: 1, a: 1, an: 1, one: 1,
  dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9,
  diez: 10, ten: 10, once: 11, eleven: 11,
};

/** Devuelve la fecha ISO estimada o undefined si no se pudo interpretar. */
export function parseRelativeDate(input: string | undefined, now: Date = new Date()): string | undefined {
  if (!input) return undefined;
  const s = input
    .toLowerCase()
    .replace(/^(editad[oa]|edited)\s*:?\s*/, '')
    .replace(/\s+en google$/, '')
    .trim();

  if (/(justo ahora|just now|reci[eé]n|hoy|today)/.test(s)) return now.toISOString();
  if (/(ayer|yesterday)/.test(s)) return new Date(now.getTime() - 86_400_000).toISOString();

  // "hace 3 semanas" | "3 weeks ago" | "hace un mes" | "a month ago"
  const m = s.match(/(?:hace\s+)?(\d+|[a-zñ]+)\s+([a-zñí]+)(?:\s+ago)?/);
  if (!m) return undefined;
  const qty = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUMBERS[m[1]];
  if (qty === undefined) return undefined;
  const unit = UNIT_DAYS.find(([re]) => re.test(m[2]));
  if (!unit) return undefined;
  return new Date(now.getTime() - qty * unit[1] * 86_400_000).toISOString();
}

export function daysBetween(fromIso: string, to: Date = new Date()): number {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / 86_400_000);
}
