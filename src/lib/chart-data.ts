import { countryHref, currentOwners, href, label, type Brand, type Group, type Reference } from './catalog';
import { metrics } from './metrics';
import type { Bucket, ChartData, Grouping, LogoFile, Point } from './treemap';

type Catalog = {
  brands: Brand[];
  groups: Group[];
  references: { reference: Reference; brand: Brand }[];
};

// Where a brand with no group owner sits when grouped by owner.
const independent: Bucket = { key: 'independent', name: 'Independent', aside: 'with no owning group on record' };

// A brand's current owners as owner-grouping keys: a group's id, or `brand:<id>` for a brand held by another brand.
const ownerKeys = (brand: Brand) => {
  const keys = currentOwners(brand).map((owner) => (owner.collection === 'groups' ? owner.id : `brand:${owner.id}`));
  return keys.length > 0 ? keys : [independent.key];
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

// An image's file and drawn size, as the chart needs it.
const logoFile = (image?: LogoFile): LogoFile | undefined => image && { src: image.src, width: image.width, height: image.height };

// The ways the brands page can group its treemap. Category and status are left out: nearly every brand is an
// active watch brand, so either would draw one huge box and a few specks. `owners` alone is what the ownership groups page uses.
export function chartData(catalog: Catalog, { groupsOnly = false } = {}): ChartData {
  const { brands, groups } = catalog;
  const measures = measuresOf(catalog);
  const brandsById = new Map(brands.map((brand) => [brand.id, brand]));

  const points: Point[] = brands.map((brand) => ({
    id: brand.id,
    name: brand.data.name,
    href: href(`/brands/${brand.id}/`),
    logos: {
      whole: logoFile(brand.data.logo),
      wordmark: logoFile(brand.data.wordmark),
      logomark: logoFile(brand.data.logomark),
    },
    buckets: {
      owner: ownerKeys(brand),
      origin: [brand.data.origin ?? 'unrecorded'],
      segment: [brand.data.segment ?? 'unrecorded'],
      none: ['all'],
    },
    licensee: brand.data.licensees.find((record) => record.to === undefined)?.licensee.id,
    ...measures.get(brand.id)!,
  }));

  const groupBuckets: Bucket[] = groups.map((group) => {
    const values: Record<string, number> = {};
    for (const metric of metrics) {
      const value = metric.groupValue?.(group);
      if (value !== undefined) values[metric.id] = value;
    }
    return { key: group.id, name: group.data.name, href: href(`/ownership-groups/${group.id}/`), values };
  });
  const owner: Grouping = { id: 'owner', label: 'Owner', buckets: groupBuckets, licensing: true };
  if (groupsOnly) return { points, groupings: [owner] };

  // Brands held by another brand sit under that brand.
  const brandOwners = [...new Set(points.flatMap((point) => point.buckets.owner).filter((key) => key.startsWith('brand:')))].map(
    (key): Bucket => {
      const brand = brandsById.get(key.slice('brand:'.length))!;
      return { key, name: brand.data.name, href: href(`/brands/${brand.id}/`) };
    },
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
