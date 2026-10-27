import { countryHref, currentOwners, href, label, type Brand, type Group, type Owner, type Reference } from './catalog';
import { metrics } from './metrics';
import { logoSetOf } from './logo-set';
import type { Bucket, ChartData, Grouping, Point } from './treemap';

type Catalog = {
  brands: Brand[];
  groups: Group[];
  references: { reference: Reference; brand: Brand }[];
};

// Where a brand with no group owner sits when grouped by owner.
const independent: Bucket = { key: 'independent', name: 'Independent', aside: 'with no owning group on record' };

// A brand's current owners as owner-grouping keys: a group's id, or `brand:<id>` for a brand held by another brand.
const ownerKey = (owner: Owner) => (owner.collection === 'groups' ? owner.id : `brand:${owner.id}`);
const ownerKeys = (brand: Brand) => {
  const keys = currentOwners(brand).map(ownerKey);
  return keys.length > 0 ? keys : [independent.key];
};
// The stakes of a brand's current part-owners, by owner-grouping key. Owners of the whole brand are left out.
const stakesOf = (brand: Brand) => {
  const stakes = brand.data.ownership.flatMap((record) =>
    record.to === undefined && record.stake !== undefined ? [[ownerKey(record.owner), record.stake] as const] : [],
  );
  return stakes.length > 0 ? Object.fromEntries(stakes) : undefined;
};

// Each brand's figure for every measure, keyed by measure id, for the treemap and the measure column.
export function measuresOf({ brands, references }: Catalog) {
  const referencesOf = Map.groupBy(references, ({ brand }) => brand.id);
  return new Map(
    brands.map((brand) => {
      const facts = { brand, references: (referencesOf.get(brand.id) ?? []).map(({ reference }) => reference) };
      const values: Record<string, number> = {};
      const captions: Record<string, string> = {};
      for (const metric of metrics) {
        const value = metric.value(facts);
        if (value !== undefined && value > 0) values[metric.id] = value;
        const caption = metric.caption?.(facts);
        if (caption) captions[metric.id] = caption;
      }
      return [brand.id, { values, captions }];
    }),
  );
}

// The ways the chart page can group brands. Category and status are left out: nearly every brand is an
// active watch brand, so either would draw one huge box and a few specks.
export async function chartData(catalog: Catalog): Promise<ChartData> {
  const { brands, groups } = catalog;
  const measures = measuresOf(catalog);
  const brandsById = new Map(brands.map((brand) => [brand.id, brand]));

  const points: Point[] = await Promise.all(brands.map(async (brand) => ({
    id: brand.id,
    name: brand.data.name,
    href: href(`/brands/${brand.id}/`),
    logos: await logoSetOf(brand),
    buckets: {
      owner: ownerKeys(brand),
      origin: [brand.data.origin ?? 'unrecorded'],
      segment: [brand.data.segment ?? 'unrecorded'],
      none: ['all'],
    },
    stakes: stakesOf(brand),
    licensee: brand.data.licensees.find((record) => record.to === undefined)?.licensee.id,
    ...measures.get(brand.id)!,
  })));

  const groupBuckets: Bucket[] = await Promise.all(groups.map(async (group) => {
    const values: Record<string, number> = {};
    for (const metric of metrics) {
      const value = metric.groupValue?.(group);
      if (value !== undefined) values[metric.id] = value;
    }
    return { key: group.id, name: group.data.name, href: href(`/ownership-groups/${group.id}/`), logos: await logoSetOf(group), values };
  }));
  const owner: Grouping = { id: 'owner', label: 'Owner', buckets: groupBuckets, licensing: true, stakes: true };

  // Brands held by another brand sit under that brand.
  const brandOwners = await Promise.all(
    [...new Set(points.flatMap((point) => point.buckets.owner).filter((key) => key.startsWith('brand:')))].map(async (key): Promise<Bucket> => {
      const brand = brandsById.get(key.slice('brand:'.length))!;
      return { key, name: brand.data.name, href: href(`/brands/${brand.id}/`), logos: await logoSetOf(brand) };
    }),
  );
  const notRecorded = (what: string): Bucket => ({ key: 'unrecorded', name: `${what} not recorded`, aside: `with no ${what.toLowerCase()} recorded` });
  const distinct = (values: (string | undefined)[]) => [...new Set(values.filter((value) => value !== undefined))].sort();
  const named = (values: string[]) =>
    values.map((value): Bucket => ({ key: value, name: label(value).replace(/^./, (first) => first.toUpperCase()) }));
  return {
    points,
    groupings: [
      { ...owner, buckets: [...groupBuckets, ...brandOwners, independent] },
      {
        id: 'origin',
        label: 'Nation of origin',
        buckets: [
          ...distinct(brands.map((brand) => brand.data.origin)).map((country): Bucket => ({ key: country, name: country, href: countryHref(country) })),
          notRecorded('Nation of origin'),
        ],
      },
      { id: 'segment', label: 'Segment', buckets: [...named(['haute', 'luxury', 'mid-range', 'budget', 'broad']), notRecorded('Segment')] },
      { id: 'none', label: 'Nothing', buckets: [{ key: 'all', name: '' }] },
    ],
  };
}
