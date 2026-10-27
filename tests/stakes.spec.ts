import { expect, test } from '@playwright/test';
import { layoutTreemap, type ChartData, type Point } from '../src/lib/treemap';

// Made-up brands, since no part-owned brand has revenue on record yet.
const point = (id: string, owners: string[], revenue: number, stakes?: Point['stakes']): Point => ({
  id,
  name: id,
  href: `/brands/${id}/`,
  logos: {},
  buckets: { owner: owners },
  stakes,
  values: { 'annual-revenue': revenue },
  captions: {},
});
const data: ChartData = {
  points: [point('whole', ['alpha'], 100), point('half', ['alpha', 'beta'], 200, { alpha: 25, beta: 'unknown' })],
  groupings: [{ id: 'owner', label: 'Owner', stakes: true, buckets: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }] }],
};
const options = { grouping: 'owner', size: 'annual-revenue', shape: 'rects' as const };

test('a part-owned brand counts in full unless asked to count by stake', () => {
  const full = layoutTreemap(data, options);
  expect(full.totals).toEqual({ alpha: 300, beta: 200 });
  expect(full.partOwned).toBe(1);

  const split = layoutTreemap(data, { ...options, byStake: true });
  // Alpha holds a quarter; Beta's stake isn't public, so it keeps the whole figure.
  expect(split.totals).toEqual({ alpha: 150, beta: 200 });
});

test('a measure that cannot be split by stake ignores the option', () => {
  const counted = { ...data, points: data.points.map((p) => ({ ...p, values: { 'total-releases': 10 } })) };
  const layout = layoutTreemap(counted, { ...options, size: 'total-releases', byStake: true });
  expect(layout.totals).toEqual({ alpha: 20, beta: 10 });
  expect(layout.partOwned).toBe(0);
});
