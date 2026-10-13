import { getCollection, type CollectionEntry } from 'astro:content';
import { refSlug } from './slug';

export { refSlug };

export type Brand = CollectionEntry<'brands'>;
export type Group = CollectionEntry<'groups'>;
export type Line = CollectionEntry<'lines'>;
export type Model = CollectionEntry<'models'>;

export const countryHref = (country: string) => `/countries/${country.toLowerCase().replace(/[^a-z]+/g, '-')}/`;

export const label = (value: string) => value.replace(/-/g, ' ');

// The site a source link points to, used as its link text where the full URL would not fit.
export const sourceHost = (source: string) => new URL(source).hostname.replace(/^www\./, '');

// Usually one, but part-owners holding stakes at the same time are all current.
export const currentOwnerIds = (brand: Brand) =>
  brand.data.ownership.filter((record) => record.to === undefined).map((record) => record.owner.id);

type Ownership = Brand['data']['ownership'][number];

// Blank for an owner of the whole brand, which is the usual case.
export const formatStake = (stake: Ownership['stake']) =>
  stake === undefined ? '' : stake === 'unknown' ? 'Unknown' : `${stake}%`;

type Period = { from: number; to?: number };

export const formatPeriods = (periods: Period[]) =>
  periods.map(({ from, to }) => `${from}–${to ?? 'present'}`).join(', ');

// Line ids are `<brand>/<line>`, which is also the path under /brands/.
export const lineHref = (line: Line) => `/brands/${line.id}/`;

export const brandStatus = ({ data }: Brand) => {
  if (data.periods.length === 0) return data.status ?? 'active';
  if (data.periods.at(-1)!.to !== undefined) return 'defunct';
  return data.periods.length > 1 ? 'revived' : 'active';
};

export type Reference = Model['data']['references'][number];

export const refHref = (model: Model, reference: Reference) => `/brands/${model.id}/${refSlug(reference.ref)}/`;

export const describeBezel = (bezel: Reference['bezel']) =>
  bezel ? [bezel.colors.join(' and '), bezel.material, bezel.style].filter(Boolean).map((part) => label(part!)).join(', ') : '';
export const describeDial = (dial: Reference['dials'][number]) => dial.name ?? dial.color;
export const describeModelNumber = ({ number, connectivity, regions }: Reference['modelNumbers'][number]) => {
  const detail = [connectivity === 'gps' ? 'GPS' : connectivity && 'GPS + Cellular', regions].filter(Boolean).join(', ');
  return detail ? `${number} (${detail})` : number;
};
export const describeBracelet = (bracelet: Reference['bracelets'][number]) => bracelet.name ?? label(bracelet.type);

// Every page asks for the catalog, so a build makes it once rather than once per page.
// The dev server rebuilds it each time instead, so edits to data show up and a failed load is not remembered.
let catalog: ReturnType<typeof buildCatalog> | undefined;
export const loadCatalog = () => (import.meta.env.DEV ? buildCatalog() : (catalog ??= buildCatalog()));

async function buildCatalog() {
  const byName = (a: Brand | Group | Model, b: Brand | Group | Model) => a.data.name.localeCompare(b.data.name);
  const brands = (await getCollection('brands')).sort(byName);
  const groups = (await getCollection('groups')).sort(byName);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const brandsOf = (groupId: string) => brands.filter((brand) => currentOwnerIds(brand).includes(groupId));
  const lines = await getCollection('lines');
  const discontinued = (line: Line) => line.data.periods.at(-1)?.to !== undefined;
  // Current lines first, then oldest first.
  const linesOf = (brandId: string) =>
    lines
      .filter((line) => line.data.brand.id === brandId)
      .sort(
        (a, b) =>
          Number(discontinued(a)) - Number(discontinued(b)) ||
          (a.data.periods[0]?.from ?? 0) - (b.data.periods[0]?.from ?? 0),
      );
  const models = (await getCollection('models')).sort(byName);
  const modelsOf = (lineId: string) => models.filter((model) => model.data.line.id === lineId);
  const collaborationsOf = (brandId: string) =>
    models.filter((model) => model.data.collaborators.some((collaborator) => collaborator.id === brandId));
  // The folder a file sits in sets its URL, so it has to agree with the parent the file names.
  for (const line of lines) {
    if (!line.id.startsWith(`${line.data.brand.id}/`)) {
      throw new Error(`Line "${line.id}" names brand "${line.data.brand.id}" but is filed under another brand's folder.`);
    }
  }
  for (const model of models) {
    if (!model.id.startsWith(`${model.data.line.id}/`)) {
      throw new Error(`Model "${model.id}" names line "${model.data.line.id}" but is filed under another line's folder.`);
    }
  }
  const references = models.flatMap((model) => {
    const line = lines.find((candidate) => candidate.id === model.data.line.id)!;
    const brand = brands.find((candidate) => candidate.id === line.data.brand.id)!;
    return model.data.references.map((reference) => ({ reference, model, line, brand }));
  });
  return { brands, groups, groupsById, brandsOf, lines, linesOf, models, modelsOf, collaborationsOf, references };
}
