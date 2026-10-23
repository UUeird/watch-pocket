import { countryHref, currentOwners, href, label, type Brand, type Group, type Reference } from './catalog';
import { metrics } from './metrics';
import { logoTone, type Tone } from './logo-tone';
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

// How each logo file sits on a fill, by its `src`.
type Tones = Map<string, Tone>;
async function tonesOf(records: (Brand | Group)[]): Promise<Tones> {
  const images = records.flatMap(({ data }) => [data.logo, data.wordmark, data.logomark]).filter((image) => image !== undefined);
  return new Map(await Promise.all(images.map(async (image) => [image.src, await logoTone(image)] as const)));
}

// An image's file and drawn size, as the chart needs it.
const logoFile = (tones: Tones, image?: LogoFile): LogoFile | undefined =>
  image && { src: image.src, width: image.width, height: image.height, ...(tones.get(image.src) ?? { onBlack: false }) };
// A brand's or group's logo and its parts.
const logosOf = (tones: Tones, { data }: Brand | Group): Point['logos'] => ({
  whole: logoFile(tones, data.logo),
  wordmark: logoFile(tones, data.wordmark),
  logomark: logoFile(tones, data.logomark),
  background: data.logoBackground,
});

// The ways the chart page can group brands. Category and status are left out: nearly every brand is an
// active watch brand, so either would draw one huge box and a few specks.
export async function chartData(catalog: Catalog): Promise<ChartData> {
  const { brands, groups } = catalog;
  const tones = await tonesOf([...brands, ...groups]);
  const measures = measuresOf(catalog);
  const brandsById = new Map(brands.map((brand) => [brand.id, brand]));

  const points: Point[] = brands.map((brand) => ({
    id: brand.id,
    name: brand.data.name,
    href: href(`/brands/${brand.id}/`),
    logos: logosOf(tones, brand),
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
    return { key: group.id, name: group.data.name, href: href(`/ownership-groups/${group.id}/`), logos: logosOf(tones, group), values };
  });
  const owner: Grouping = { id: 'owner', label: 'Owner', buckets: groupBuckets, licensing: true };

  // Brands held by another brand sit under that brand.
  const brandOwners = [...new Set(points.flatMap((point) => point.buckets.owner).filter((key) => key.startsWith('brand:')))].map(
    (key): Bucket => {
      const brand = brandsById.get(key.slice('brand:'.length))!;
      return { key, name: brand.data.name, href: href(`/brands/${brand.id}/`), logos: logosOf(tones, brand) };
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
