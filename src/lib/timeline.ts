import { currentOwners, formatStake, type Brand, type Owner } from './catalog';

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

// One owner's timeline: the brands it has held, and how many of them have no years to draw.
export type Section = { name: string; rows: Lifeline[]; undated: number };

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

const holds = (brand: Brand, owner: Owner) => brand.data.ownership.some((record) => record.owner.collection === owner.collection && record.owner.id === owner.id);
const holdsNow = (brand: Brand, owner: Owner) => currentOwners(brand).some((other) => other.collection === owner.collection && other.id === owner.id);

// Every brand an owner has held, now or before, and every brand held now by one it holds now, down the chain: a
// group that owns Bulova also has Caravelle, which Bulova owns.
export function heldBy(owner: Owner, brands: Brand[]): Brand[] {
  const found = new Map(brands.filter((brand) => holds(brand, owner)).map((brand) => [brand.id, brand]));
  const queue = brands.filter((brand) => holdsNow(brand, owner));
  for (let parent = queue.shift(); parent; parent = queue.shift()) {
    for (const brand of brands) {
      if (found.has(brand.id) || !holdsNow(brand, { collection: 'brands', id: parent.id })) continue;
      found.set(brand.id, brand);
      queue.push(brand);
    }
  }
  return [...found.values()];
}

// An owner's timeline, for its own page: the brands it has held, oldest first.
export function ownerSection(name: string, held: Brand[], ownerName: (owner: Owner) => string | undefined): Section {
  const lines = [...new Map(held.map((brand) => [brand.id, brand])).values()].map((brand) => lifelineOf(brand, ownerName));
  const rows = lines.filter((line) => line !== undefined).sort((a, b) => a.first - b.first || a.brand.data.name.localeCompare(b.brand.data.name));
  return { name, rows, undated: lines.length - rows.length };
}
