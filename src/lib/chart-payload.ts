import type { LogoSet } from './logo';

// What the Chart page sends to the browser: the whole catalog as one tree's worth of records, which the page's
// script (src/scripts/chart/) arranges into owner → brand → line → model → reference. Plain data only.
// Money is in US dollars, converted as in src/lib/metrics.ts.

export type ChartGroup = {
  id: string;
  name: string;
  href: string;
  country?: string;
  control?: string;
  // The group this one is a subsidiary of.
  parent?: string;
  // The whole company's latest revenue, other businesses included.
  revenue?: number;
};

export type ChartBrand = {
  id: string;
  name: string;
  href: string;
  // Current owners: a group's id, or `brand:<id>` for a brand held by another brand. Empty for an independent brand.
  owners: string[];
  // Each current owner's stake in percent, in the order of `owners`, where a stake is recorded.
  stakes?: (number | null)[];
  origin?: string;
  headquarters?: string;
  madeIn: string[];
  segment?: string;
  founded?: number;
  trading: boolean;
  revenue?: number;
  production?: number;
  logo?: LogoSet;
};

export type ChartLine = { id: string; brand: string; name: string; href: string; since?: number };

export type ChartReference = {
  ref: string;
  href: string;
  since?: number;
  until?: number;
  caseSize?: number;
  metals: string[];
  price?: number;
};

export type ChartModel = { id: string; line: string; name: string; href: string; style?: string; references: ChartReference[] };

export type ChartPayload = {
  groups: ChartGroup[];
  brands: ChartBrand[];
  lines: ChartLine[];
  models: ChartModel[];
  // Each country's flag, for those that have one.
  flags: Record<string, string>;
};
