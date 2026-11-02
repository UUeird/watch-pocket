import { brandStatus, currentOwners, href, lineHref, refHref, type Brand, type Group, type Line, type Model, type Owner, type Reference } from './catalog';
import type { ChartGroup, ChartPayload } from './chart-payload';
import { countries } from './countries';
import { logoSetOf } from './logo-set';
import { measuresOf, metricById, toUsd } from './metrics';

type Catalog = {
  brands: Brand[];
  groups: Group[];
  lines: Line[];
  models: Model[];
  references: { reference: Reference; brand: Brand }[];
};

const ownerKey = (owner: Owner) => (owner.collection === 'groups' ? owner.id : `brand:${owner.id}`);

// The Chart page's data: every brand with its current owners, the groups above them, and every line, model and
// reference recorded. A brand's facts are sent once however many owners it has, so the page counts it once.
export async function chartPayload({ brands, groups, lines, models, references }: Catalog): Promise<ChartPayload> {
  const measures = measuresOf({ brands, references });
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const groupRevenue = metricById('annual-revenue').groupValue!;

  // Only groups that own a brand now, and the groups above them, appear on the chart.
  const shown = new Set<string>();
  const keep = (id: string) => {
    if (shown.has(id)) return;
    shown.add(id);
    const parent = groupsById.get(id)?.data.parent;
    if (parent) keep(parent.id);
  };
  for (const brand of brands) for (const owner of currentOwners(brand)) if (owner.collection === 'groups') keep(owner.id);

  return {
    groups: groups
      .filter((group) => shown.has(group.id))
      .map(
        (group): ChartGroup => ({
          id: group.id,
          name: group.data.name,
          href: href(`/ownership-groups/${group.id}/`),
          country: group.data.country,
          control: group.data.control,
          parent: group.data.parent?.id,
          revenue: groupRevenue(group),
        }),
      ),
    brands: await Promise.all(
      brands.map(async (brand) => {
        const current = brand.data.ownership.filter((record) => record.to === undefined);
        const stakes = current.map((record) => (typeof record.stake === 'number' ? record.stake : null));
        const logo = await logoSetOf(brand);
        const { values } = measures.get(brand.id)!;
        const status = brandStatus(brand);
        return {
          id: brand.id,
          name: brand.data.name,
          href: href(`/brands/${brand.id}/`),
          owners: current.map((record) => ownerKey(record.owner)),
          stakes: stakes.some((stake) => stake !== null) ? stakes : undefined,
          origin: brand.data.origin,
          headquarters: brand.data.headquarters,
          madeIn: brand.data.manufacturing,
          segment: brand.data.segment,
          founded: brand.data.periods[0]?.from,
          trading: status === 'active' || status === 'revived',
          revenue: values['annual-revenue'],
          production: values.production,
          logo: logo.whole ? logo : undefined,
        };
      }),
    ),
    lines: lines.map((line) => ({
      id: line.id,
      brand: line.data.brand.id,
      name: line.data.name,
      href: lineHref(line),
      since: line.data.periods[0]?.from,
    })),
    models: models.map((model) => ({
      id: model.id,
      line: model.data.line.id,
      name: model.data.name,
      href: href(`/brands/${model.id}/`),
      style: model.data.style,
      references: model.data.references.map((reference) => ({
        ref: reference.ref,
        href: refHref(model, reference),
        since: reference.periods[0]?.from,
        until: reference.periods.at(-1)?.to,
        caseSize: reference.caseSize,
        metals: reference.metals,
        price: reference.price && toUsd(reference.price.amount, reference.price.currency),
      })),
    })),
    flags: Object.fromEntries(Object.entries(countries).flatMap(([name, { flag }]) => (flag ? [[name, flag]] : []))),
  };
}
