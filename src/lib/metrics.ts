import type { Brand, Group, Reference } from './catalog';

type Currency = NonNullable<Reference['price']>['currency'];
type Revenue = Brand['data']['revenue'][number];

// Approximate US dollars per unit, used only to put figures in different currencies on one scale.
// Rough 2025 averages: good enough for relative sizes, not for quoting a figure.
const usdPer: Record<Currency, number> = {
  USD: 1,
  CHF: 1.18,
  EUR: 1.11,
  GBP: 1.31,
  JPY: 0.0066,
  HKD: 0.128,
  INR: 0.0117,
  CNY: 0.138,
};
export const toUsd = (amount: number, currency: Currency) => amount * usdPer[currency];

const thisYear = new Date().getFullYear();
// New references are averaged over this many recent years, since a single year is too lumpy to compare.
const releaseWindow = 5;

const latest = (revenue: Revenue[]) => revenue.reduce<Revenue | undefined>((best, r) => (!best || r.year > best.year ? r : best), undefined);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]) => (values.length === 0 ? undefined : sum(values) / values.length);

// Everything a measure needs about a brand, gathered once.
export type BrandFacts = { brand: Brand; references: Reference[] };

export type Metric = {
  id: string;
  label: string;
  // How to read a value, for tooltips and the key.
  format: (value: number) => string;
  value: (facts: BrandFacts) => number | undefined;
  // A short fact shown with the brand where there is room, e.g. the founding year behind an age.
  caption?: (facts: BrandFacts) => string | undefined;
  // Whether brands a group makes under license count toward it. They do for what the group makes
  // (production), but not for what it owns (age, a brand's own revenue).
  includesLicensed?: boolean;
  // The part of a group's own figure not explained by its brands, e.g. revenue from other businesses.
  groupValue?: (group: Group) => number | undefined;
  // Whether brands' figures add up to something meaningful for a group. Revenue and counts do, so they
  // can size a whole treemap; ages and average prices do not, so they size brands only within one bucket.
  additive: boolean;
  // The same for every brand, so it says something about buckets and nothing about the brands in them.
  uniform?: boolean;
  // Whether a part-owner can be credited with only its stake of a brand's figure, as with revenue.
  byStake?: boolean;
};

const usd = (value: number) =>
  value >= 1e9 ? `$${(value / 1e9).toFixed(1)}B` : value >= 1e6 ? `$${Math.round(value / 1e6)}M` : `$${Math.round(value).toLocaleString('en-US')}`;

const releaseYear = (reference: Reference) => reference.periods[0]?.from;

export const metrics: Metric[] = [
  {
    id: 'brands',
    label: 'Number of brands',
    format: (count) => `${count} brand${count === 1 ? '' : 's'}`,
    value: () => 1,
    additive: true,
    uniform: true,
  },
  {
    id: 'age',
    label: 'Age',
    format: (years) => `${Math.round(years)} years`,
    value: ({ brand }) => {
      const founded = brand.data.periods[0]?.from;
      return founded === undefined ? undefined : Math.max(1, thisYear - founded);
    },
    caption: ({ brand }) => (brand.data.periods[0] ? `Est. ${brand.data.periods[0].from}` : undefined),
    additive: false,
  },
  {
    id: 'age-heritage',
    label: 'Age, including claimed heritage',
    format: (years) => `${Math.round(years)} years`,
    value: ({ brand }) => {
      const since = brand.data.heritage?.from ?? brand.data.periods[0]?.from;
      return since === undefined ? undefined : Math.max(1, thisYear - since);
    },
    caption: ({ brand }) => {
      const founded = brand.data.periods[0]?.from;
      const heritage = brand.data.heritage?.from;
      if (heritage === undefined) return founded === undefined ? undefined : `Est. ${founded}`;
      return founded === undefined ? `Heritage ${heritage}` : `Heritage ${heritage} · est. ${founded}`;
    },
    additive: false,
  },
  {
    id: 'annual-revenue',
    label: 'Annual revenue',
    format: usd,
    value: ({ brand }) => {
      const figure = latest(brand.data.revenue);
      return figure && toUsd(figure.amount, figure.currency);
    },
    groupValue: (group) => {
      const figure = latest(group.data.revenue);
      return figure && toUsd(figure.amount, figure.currency);
    },
    additive: true,
    byStake: true,
  },
  {
    id: 'lifetime-revenue',
    label: 'Revenue on record (all years)',
    format: usd,
    value: ({ brand }) =>
      brand.data.revenue.length === 0 ? undefined : sum(brand.data.revenue.map((r) => toUsd(r.amount, r.currency))),
    groupValue: (group) =>
      group.data.revenue.length === 0 ? undefined : sum(group.data.revenue.map((r) => toUsd(r.amount, r.currency))),
    additive: true,
    byStake: true,
  },
  {
    id: 'production',
    label: 'Watches made a year',
    format: (units) => `${units.toLocaleString('en-US')} watches a year`,
    value: ({ brand }) => brand.data.production?.units,
    includesLicensed: true,
    additive: true,
  },
  {
    id: 'annual-releases',
    label: `New references a year (last ${releaseWindow} years)`,
    format: (count) => `${count.toFixed(1)} a year`,
    value: ({ references }) => {
      const recent = references.filter((reference) => (releaseYear(reference) ?? 0) > thisYear - releaseWindow);
      return recent.length === 0 ? undefined : recent.length / releaseWindow;
    },
    additive: true,
  },
  {
    id: 'total-releases',
    label: 'References on record',
    format: (count) => `${count} references`,
    value: ({ references }) => (references.length === 0 ? undefined : references.length),
    additive: true,
  },
  {
    id: 'average-price',
    label: 'Average list price',
    format: usd,
    value: ({ references }) => mean(references.flatMap(({ price }) => (price ? [toUsd(price.amount, price.currency)] : []))),
    additive: false,
  },
];
