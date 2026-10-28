import { getCollection, type CollectionEntry } from 'astro:content';
import { refSlug } from './slug';
import { checkBrandFacts, checkModelsAgreeWithBrands } from './consistency';

export { refSlug };

export type Brand = CollectionEntry<'brands'>;
export type Group = CollectionEntry<'groups'>;
export type Line = CollectionEntry<'lines'>;
export type Model = CollectionEntry<'models'>;

// A site path such as `/brands/rolex/`, prefixed with the base the site is served under.
export const href = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;

export const countrySlug = (country: string) => country.toLowerCase().replace(/[^a-z]+/g, '-');

export const countryHref = (country: string) => href(`/countries/${countrySlug(country)}/`);

export const label = (value: string) => value.replace(/-/g, ' ');

// Who controls a group, in words. A group with a parent is that parent's subsidiary.
export const controlNames = { public: 'Publicly traded', family: 'Family-owned', private: 'Privately held', foundation: 'Foundation-owned' };
export type Control = keyof typeof controlNames;
export const describeControl = ({ data: { control, parent, dissolved } }: Group) =>
  dissolved !== undefined ? `Dissolved in ${dissolved}` : parent || !control ? 'Subsidiary' : controlNames[control];

// Groups that still exist, for lists of current owners.
export const activeGroups = (groups: Group[]) => groups.filter((group) => group.data.dissolved === undefined);

// A count with its noun, e.g. `1 brand` or `3 brands`.
export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

// The site a source link points to, used as its link text where the full URL would not fit.
export const sourceHost = (source: string) => new URL(source).hostname.replace(/^www\./, '');

type Ownership = Brand['data']['ownership'][number];
// A group or another brand.
export type Owner = Ownership['owner'];

// Usually one, but part-owners holding stakes at the same time are all current.
export const currentOwners = (brand: Brand) =>
  brand.data.ownership.filter((record) => record.to === undefined).map((record) => record.owner);

export const ownerHref = ({ collection, id }: Owner) =>
  href(collection === 'brands' ? `/brands/${id}/` : `/ownership-groups/${id}/`);

// Blank for an owner of the whole brand, which is the usual case.
export const formatStake = (stake: Ownership['stake']) =>
  stake === undefined ? '' : stake === 'unknown' ? 'Unknown' : `${stake}%`;

type Period = { from: number; to?: number };

export const formatPeriods = (periods: Period[]) =>
  periods.map(({ from, to }) => `${from}–${to ?? 'present'}`).join(', ');

// Line ids are `<brand>/<line>`, which is also the path under /brands/.
export const lineHref = (line: Line) => href(`/brands/${line.id}/`);

export const brandStatus = ({ data }: Brand) => {
  if (data.periods.length === 0) return data.status ?? 'active';
  if (data.periods.at(-1)!.to !== undefined) return 'defunct';
  return data.periods.length > 1 ? 'revived' : 'active';
};

// The years a brand traded, up to the present while it still does. Without recorded years, its status unless that is plain active.
export const brandYears = (brand: Brand) => {
  const status = brandStatus(brand);
  return formatPeriods(brand.data.periods) || (status === 'active' ? '' : status[0].toUpperCase() + status.slice(1));
};

export type Reference = Model['data']['references'][number];

export const refHref = (model: Model, reference: Reference) => href(`/brands/${model.id}/${refSlug(reference.ref)}/`);

// A reference's complications in words: "Time only" for an empty list, nothing when they are not recorded.
export const describeComplications = (complications: Reference['complications']) =>
  complications && (complications.length === 0 ? 'Time only' : complications.map((entry) => (entry === 'gmt' ? 'GMT' : label(entry))).join(', '));

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
  const brandsById = new Map(brands.map((brand) => [brand.id, brand]));
  const ownerName = ({ collection, id }: Owner) => (collection === 'brands' ? brandsById : groupsById).get(id)?.data.name;
  const owns = (owner: Owner, other: Owner) => owner.collection === other.collection && owner.id === other.id;
  // Every ownership record naming this owner, current ones first.
  const holdingsOf = (owner: Owner) =>
    brands
      .flatMap((brand) => brand.data.ownership.filter((record) => owns(record.owner, owner)).map((record) => ({ brand, ...record })))
      .sort((a, b) => Number(a.to !== undefined) - Number(b.to !== undefined));
  // Who controls a brand: its own `control` when nothing owns it, or its owner's, through any parent groups and
  // owning brands. `via` names the company at the top of that chain. Unknown for a brand with several current owners.
  const groupControl = (group: Group): { control: Control; via?: string } | undefined =>
    group.data.parent ? groupControl(groupsById.get(group.data.parent.id)!) : group.data.control && { control: group.data.control, via: group.data.name };
  const brandControl = (brand: Brand): { control: Control; via?: string } | undefined => {
    const owners = currentOwners(brand);
    if (owners.length === 0) return brand.data.control ? { control: brand.data.control } : undefined;
    if (owners.length > 1) return undefined;
    const [owner] = owners;
    if (owner.collection === 'groups') return groupControl(groupsById.get(owner.id)!);
    const parent = brandsById.get(owner.id)!;
    const above = brandControl(parent);
    return above && { control: above.control, via: above.via ?? parent.data.name };
  };
  const brandsOf = (groupId: string) =>
    brands.filter((brand) => currentOwners(brand).some((owner) => owns(owner, { collection: 'groups', id: groupId })));
  // Brands a group currently makes and sells under license, without owning them.
  const licensesOf = (groupId: string) =>
    brands.filter((brand) => brand.data.licensees.some((record) => record.licensee.id === groupId && record.to === undefined));
  for (const brand of brands) {
    for (const { owner } of brand.data.ownership) {
      if (ownerName(owner) === undefined) {
        throw new Error(`Brand "${brand.id}" names an owner that does not exist: "${owner.id}" in ${owner.collection}.`);
      }
      if (owns(owner, { collection: 'brands', id: brand.id })) {
        throw new Error(`Brand "${brand.id}" is listed as its own owner.`);
      }
    }
  }
  const lines = await getCollection('lines');
  const discontinued = (line: Line) => line.data.periods.at(-1)?.to !== undefined;
  // Current lines first, then oldest first, then by name, with numbers in number order (RM 07 before RM 032).
  const linesOf = (brandId: string) =>
    lines
      .filter((line) => line.data.brand.id === brandId)
      .sort(
        (a, b) =>
          Number(discontinued(a)) - Number(discontinued(b)) ||
          (a.data.periods[0]?.from ?? 0) - (b.data.periods[0]?.from ?? 0) ||
          a.data.name.localeCompare(b.data.name, 'en', { numeric: true }),
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
  checkBrandFacts(brands);
  checkModelsAgreeWithBrands(models, lines, brands);
  const references = models.flatMap((model) => {
    const line = lines.find((candidate) => candidate.id === model.data.line.id)!;
    const brand = brands.find((candidate) => candidate.id === line.data.brand.id)!;
    return model.data.references.map((reference) => ({ reference, model, line, brand }));
  });
  return { brands, groups, groupsById, ownerName, brandControl, holdingsOf, brandsOf, licensesOf, lines, linesOf, models, modelsOf, collaborationsOf, references };
}
