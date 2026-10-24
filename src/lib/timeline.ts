import { currentOwners, formatStake, type Brand, type Group, type Owner } from './catalog';

// A brand's life as the timeline draws it: the years it traded, any heritage it claims, and who has owned it.
// `lane` stacks holdings that overlap, as part-owners at the same time do.
export type Holding = { owner: Owner; name: string; from: number; to?: number; stake?: number | 'unknown'; lane: number };
export type Lifeline = {
  brand: Brand;
  // When the brand traded. A gap between periods is a dormant spell.
  periods: { from: number; to?: number }[];
  // A year the brand claims as its start before its own founding, drawn fainter.
  heritage?: number;
  // Holdings with a start year, in order. Undated ones can't be placed.
  holdings: Holding[];
  // How many holdings overlap at most, so the row is tall enough to stack them.
  lanes: number;
  // The year the row sorts by: its founding, or failing that its first purchase.
  first: number;
};

// A section of the page: one owner and the brands it holds now.
export type Section = { key: string; name: string; href?: string; group?: Group; rows: Lifeline[]; undated: number };

export function lifelineOf(brand: Brand, ownerName: (owner: Owner) => string | undefined): Lifeline | undefined {
  const periods = brand.data.periods;
  const holdings = brand.data.ownership
    .filter((record) => record.from !== undefined)
    .map((record) => ({ owner: record.owner, name: ownerName(record.owner) ?? record.owner.id, from: record.from!, to: record.to, stake: record.stake, lane: 0 }))
    .sort((a, b) => a.from - b.from);
  // Each holding takes the first lane free by its start year.
  const ends: number[] = [];
  for (const holding of holdings) {
    let lane = ends.findIndex((end) => end <= holding.from);
    if (lane === -1) lane = ends.push(0) - 1;
    ends[lane] = holding.to ?? Infinity;
    holding.lane = lane;
  }
  const first = periods[0]?.from ?? holdings[0]?.from;
  if (first === undefined) return undefined;
  return { brand, periods, heritage: brand.data.heritage?.from, holdings, lanes: Math.max(1, ends.length), first };
}

// The lines of a brand's tooltip: its name, its years, then each owner in turn.
export function describe({ brand, periods, heritage, holdings }: Lifeline) {
  const lines = [brand.data.name];
  if (heritage !== undefined) lines.push(`Claims heritage from ${heritage}`);
  if (periods.length === 1 && periods[0].to === undefined) lines.push(`Founded ${periods[0].from}`);
  else if (periods.length > 0) lines.push(`Traded ${periods.map(({ from, to }) => `${from}–${to ?? 'present'}`).join(', ')}`);
  for (const holding of holdings) lines.push(describeHolding(holding));
  return lines;
}

export const describeHolding = ({ name, from, to, stake }: Holding) => {
  const share = stake === undefined ? '' : stake === 'unknown' ? ', part-owned' : `, ${formatStake(stake)} stake`;
  return to === undefined ? `${name}${share} since ${from}` : `${name}${share} ${from}–${to}`;
};

// Brands sorted into sections by who owns them now: each group, largest first, then brands held by another
// brand, then independents. A brand with several part-owners sits under each.
export function sectionsOf(
  brands: Brand[],
  groups: Group[],
  ownerName: (owner: Owner) => string | undefined,
  groupHref: (group: Group) => string,
): Section[] {
  const sections = new Map<string, Section>();
  const section = (key: string, make: () => Omit<Section, 'rows' | 'undated'>) => {
    if (!sections.has(key)) sections.set(key, { ...make(), rows: [], undated: 0 });
    return sections.get(key)!;
  };
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  for (const brand of brands) {
    const owners = currentOwners(brand);
    const keys = owners.length === 0 ? ['independent'] : owners.map((owner) => (owner.collection === 'groups' ? owner.id : 'brands'));
    const line = lifelineOf(brand, ownerName);
    for (const key of new Set(keys)) {
      const target = section(key, () => {
        if (key === 'independent') return { key, name: 'Independent' };
        if (key === 'brands') return { key, name: 'Held by another brand' };
        const group = groupsById.get(key)!;
        return { key, name: group.data.name, href: groupHref(group), group };
      });
      if (line) target.rows.push(line);
      else target.undated++;
    }
  }
  for (const { rows } of sections.values()) rows.sort((a, b) => a.first - b.first || a.brand.data.name.localeCompare(b.brand.data.name));
  const rank = (key: string) => (key === 'independent' ? 2 : key === 'brands' ? 1 : 0);
  return [...sections.values()]
    .filter((entry) => entry.rows.length > 0)
    .sort((a, b) => rank(a.key) - rank(b.key) || b.rows.length - a.rows.length || a.name.localeCompare(b.name));
}
