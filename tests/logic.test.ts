import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from '../src/main/classifier';
import { toCsv } from '../src/main/csv';
import { parseRelativeDate } from '../src/main/dates';
import { zoneContains, zoneToCells } from '../src/shared/grid';
import { formatBoundsZone, parseZones } from '../src/renderer/zones';
import { DEFAULT_SETTINGS, type Business } from '../src/shared/types';

const NOW = new Date('2026-10-08T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function biz(over: Partial<Business> = {}): Business {
  return {
    id: 'x', name: 'Panadería Sol', category: 'Panadería', reviews: [], zones: ['Z'], queries: ['q'],
    firstSeenAt: NOW.toISOString(), lastSeenAt: NOW.toISOString(), appearedInRescan: false, history: [],
    classification: undefined as never, leadStatus: 'pendiente', notes: '', ...over,
  };
}

test('parseRelativeDate entiende español e inglés', () => {
  assert.equal(parseRelativeDate('hace 2 semanas', NOW), daysAgo(14));
  assert.equal(parseRelativeDate('hace un mes', NOW), daysAgo(30));
  assert.equal(parseRelativeDate('Editado hace 3 días', NOW), daysAgo(3));
  assert.equal(parseRelativeDate('a year ago', NOW), daysAgo(365));
  assert.equal(parseRelativeDate('5 months ago', NOW), daysAgo(150));
  assert.equal(parseRelativeDate('ayer', NOW), daysAgo(1));
  assert.equal(parseRelativeDate('cualquier cosa', NOW), undefined);
});

test('negocio nuevo, activo y sin web es lead alto', () => {
  const reviews = [
    { date: daysAgo(10), text: 'Muy rico pero solo efectivo, no aceptan tarjeta' },
    { date: daysAgo(40), text: 'Excelente' },
    { date: daysAgo(70) },
  ];
  const c = classify(biz({ reviewCount: 3, reviews, phone: '123' }), DEFAULT_SETTINGS, NOW);
  assert.equal(c.isNewBusiness, true);
  assert.equal(c.activity, 'activo');
  assert.equal(c.leadTier, 'alto');
  assert.ok(c.opportunities.includes('Sitio web / landing page'));
  assert.ok(c.opportunities.includes('Medios de pago / POS'));
});

test('cadena grande con web propia e inactiva es lead bajo', () => {
  const c = classify(
    biz({ name: 'MegaCorp', category: 'Banco', reviewCount: 5000, website: 'https://megacorp.com', reviews: [{ date: daysAgo(400) }] }),
    DEFAULT_SETTINGS, NOW,
  );
  assert.equal(c.isNewBusiness, false);
  assert.equal(c.activity, 'inactivo');
  assert.equal(c.leadTier, 'bajo');
});

test('web en Instagram cuenta como presencia débil', () => {
  const c = classify(biz({ website: 'https://www.instagram.com/sol', reviewCount: 50 }), DEFAULT_SETTINGS, NOW);
  assert.ok(c.leadReasons.some((r) => r.includes('instagram.com')));
});

test('reseñas nuevas entre escaneos marcan actividad', () => {
  const history = [{ at: daysAgo(30), reviewCount: 40 }, { at: NOW.toISOString(), reviewCount: 44 }];
  const c = classify(biz({ reviewCount: 44, history }), DEFAULT_SETTINGS, NOW);
  assert.equal(c.newReviewsSinceLastScan, 4);
  assert.equal(c.activity, 'activo');
});

test('cerrado permanentemente tiene puntaje 0', () => {
  const c = classify(biz({ businessStatus: 'closed_permanently', reviewCount: 2 }), DEFAULT_SETTINGS, NOW);
  assert.equal(c.activity, 'cerrado');
  assert.equal(c.leadScore, 0);
  assert.equal(c.isNewBusiness, false);
});

test('parseZones acepta texto, coordenadas y grilla', () => {
  const { zones, errors } = parseZones('Palermo, CABA\n# comentario\n-34.6,-58.4\nCentro | -31.41,-64.18 | 2 | 3\nMal | xx');
  assert.equal(zones.length, 3);
  assert.equal(zones[0].text, 'Palermo, CABA');
  assert.deepEqual(zones[1].center, { lat: -34.6, lng: -58.4 });
  assert.equal(zones[2].gridSize, 3);
  assert.equal(errors.length, 1);
});

test('zoneToCells genera grilla NxN alrededor del centro', () => {
  const cells = zoneToCells({ label: 'C', center: { lat: -31.4, lng: -64.18 }, radiusKm: 2, gridSize: 3 });
  assert.equal(cells.length, 9);
  const mid = cells[4].center!;
  assert.ok(Math.abs(mid.lat + 31.4) < 1e-9 && Math.abs(mid.lng + 64.18) < 1e-9);
});

test('CSV escapa separadores y neutraliza fórmulas', () => {
  const b = biz({ name: '=HYPERLINK("x")', notes: 'a;b' });
  b.classification = classify(b, DEFAULT_SETTINGS, NOW);
  const csv = toCsv([b]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('"a;b"'));
});

test('zona marcada en el mapa: formato de ida y vuelta, grilla y filtro', () => {
  const zone = { label: 'Palermo, Buenos Aires', bounds: { south: -34.595, west: -58.445, north: -34.565, east: -58.4 }, cellKm: 1 };
  const line = formatBoundsZone(zone);
  const { zones, errors } = parseZones(line);
  assert.deepEqual(errors, []);
  assert.deepEqual(zones[0], zone);

  // ~4.1 km de ancho × 3.3 km de alto con celdas de 1 km → 5 × 4.
  assert.equal(zoneToCells(zone).length, 20);
  assert.equal(zoneContains(zone, { lat: -34.58, lng: -58.42 }), true);
  assert.equal(zoneContains(zone, { lat: -34.6, lng: -58.62 }), false); // Hurlingham
  assert.equal(zoneContains({ label: 'texto', text: 'x' }, { lat: 0, lng: 0 }), true);
});

test('rectángulo enorme se limita a 100 búsquedas', () => {
  const cells = zoneToCells({ label: 'AMBA', bounds: { south: -35, west: -59, north: -34, east: -58 }, cellKm: 0.5 });
  assert.ok(cells.length <= 100 && cells.length > 50);
});

test('esquinas invertidas son un error', () => {
  const { errors } = parseZones('X | -34.5,-58.4 ; -34.6,-58.5 | 1');
  assert.equal(errors.length, 1);
});
