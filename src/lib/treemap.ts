import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import type { Brand, Group } from './catalog';
import type { BrandFacts, Metric } from './metrics';

// The layout is worked out in this box and drawn in percentages, so it scales with the page.
export const box = { width: 1000, height: 600 };
// Room at the top of each group for its name.
const groupHeader = 20;

type Datum =
  | { kind: 'root'; children: Datum[] }
  | { kind: 'group'; group: Group; children: Datum[] }
  | { kind: 'brand'; brand: Brand; value: number; licensed: boolean }
  | { kind: 'other'; group: Group; value: number };

export type Cell = {
  kind: 'group' | 'brand' | 'other';
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  group: Group;
  brand?: Brand;
  // Made by the group under license rather than owned by it.
  licensed?: boolean;
  caption?: string;
};

export type Layout = {
  metric: Metric;
  cells: Cell[];
  // Brands in these groups with no figure for this measure, so left out of the sizing.
  missing: Brand[];
  // Brands these groups make under license, left out because this measure counts only what a group owns.
  hiddenLicensed: Brand[];
  // For a measure a group has its own figure for: whether that figure's surplus over its brands is shown.
  // Unset for measures with no group figure.
  otherBusiness?: boolean;
};

// A brand made under license by one of these groups. Where a measure counts licensed brands, it sits
// with the group that makes it rather than the one that owns it, so it is not counted twice.
const licensedOut = (brand: Brand) => brand.data.licensees.some((record) => record.to === undefined);

export function layoutTreemap(
  held: { group: Group; brands: Brand[]; licensed: Brand[] }[],
  metric: Metric,
  factsOf: (brand: Brand) => BrandFacts,
  { otherBusiness = true }: { otherBusiness?: boolean } = {},
): Layout {
  const missing: Brand[] = [];
  const hiddenLicensed: Brand[] = [];
  const groups: Datum[] = [];
  for (const { group, brands, licensed } of held) {
    const members = metric.includesLicensed
      ? [...brands.filter((brand) => !licensedOut(brand)).map((brand) => ({ brand, licensed: false })), ...licensed.map((brand) => ({ brand, licensed: true }))]
      : brands.map((brand) => ({ brand, licensed: false }));
    if (!metric.includesLicensed) hiddenLicensed.push(...licensed);
    const children: Datum[] = [];
    for (const { brand, licensed } of members) {
      const value = metric.value(factsOf(brand));
      if (value === undefined || value <= 0) missing.push(brand);
      else children.push({ kind: 'brand', brand, value, licensed });
    }
    // Whatever the group's own figure has beyond its brands' is shown as a block of its own.
    const brandTotal = children.reduce((total, child) => total + (child.kind === 'brand' ? child.value : 0), 0);
    const groupTotal = otherBusiness ? metric.groupValue?.(group) : undefined;
    if (groupTotal !== undefined && groupTotal > brandTotal) children.push({ kind: 'other', group, value: groupTotal - brandTotal });
    if (children.length > 0) groups.push({ kind: 'group', group, children });
  }

  const root = hierarchy<Datum>({ kind: 'root', children: groups }, (d) => ('children' in d ? d.children : undefined))
    .sum((d) => ('value' in d ? d.value : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const laidOut = treemap<Datum>()
    .tile(treemapSquarify)
    .size([box.width, box.height])
    .paddingOuter(3)
    .paddingInner(2)
    .paddingTop((node) => (node.depth === 1 ? groupHeader : 3))(root);

  const cells = laidOut.descendants().flatMap((node): Cell[] => {
    const d = node.data;
    if (d.kind === 'root') return [];
    const shape = { x: node.x0, y: node.y0, width: node.x1 - node.x0, height: node.y1 - node.y0, value: node.value ?? 0 };
    if (d.kind === 'brand') {
      const group = (node.parent!.data as Extract<Datum, { kind: 'group' }>).group;
      return [{ kind: 'brand', ...shape, group, brand: d.brand, licensed: d.licensed, caption: metric.caption?.(factsOf(d.brand)) }];
    }
    return [{ kind: d.kind, ...shape, group: d.group }];
  });

  return { metric, cells, missing, hiddenLicensed, otherBusiness: metric.groupValue ? otherBusiness : undefined };
}
