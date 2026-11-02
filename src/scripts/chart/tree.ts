import { hierarchy, type HierarchyNode } from 'd3-hierarchy';
import type { ChartBrand, ChartGroup, ChartLine, ChartModel, ChartPayload, ChartReference } from '../../lib/chart-payload';

// The Chart page's model: the catalog as one tree, owner → brand → line → model → reference, with an optional
// grouping level above the owners, cut down by the filters and search, then trimmed to the levels in view.

export const LEVELS = ['owner', 'brand', 'line', 'model', 'ref'] as const;
export type Level = (typeof LEVELS)[number];
export type Kind = 'root' | 'lens' | Level;

export const LEVEL_NAMES: Record<Kind, string> = { root: 'All', lens: 'Group', owner: 'Owner', brand: 'Brand', line: 'Line', model: 'Model', ref: 'Reference' };
export const LEVEL_PLURALS: Record<Level, string> = { owner: 'Owners', brand: 'Brands', line: 'Lines', model: 'Models', ref: 'References' };
export const NOT_RECORDED = 'Not recorded';
// The value that stands for "not recorded" in the country and segment filters and in links.
export const UNRECORDED = 'unrecorded';

export const SEGMENTS = ['haute', 'luxury', 'mid-range', 'budget', 'broad'] as const;
export const segmentName = (segment?: string) =>
  ({ haute: 'Haute horlogerie', luxury: 'Luxury', 'mid-range': 'Mid-range', budget: 'Budget', broad: 'Broad range' })[segment ?? ''] ?? NOT_RECORDED;
export const ERAS = ['Before 1900', '1900–1969', '1970–1999', '2000 and later', NOT_RECORDED];
const eraOf = (year?: number) =>
  year === undefined ? NOT_RECORDED : year < 1900 ? ERAS[0] : year < 1970 ? ERAS[1] : year < 2000 ? ERAS[2] : ERAS[3];

export type CountryMeaning = 'origin' | 'owner' | 'hq' | 'made';
export type GroupBy = 'none' | 'country' | 'segment' | 'era';
export type Sort = 'count' | 'models' | 'brands' | 'age' | 'revenue' | 'production' | 'price' | 'name';
export type View = 'columns' | 'outline';

export type State = {
  q: string;
  countries: Set<string>;
  countryMeaning: CountryMeaning;
  segments: Set<string>;
  status: Set<string>;
  groupBy: GroupBy;
  // The levels shown, as indexes into LEVELS. `to` is the level asked for; the view may stop short of it.
  from: number;
  to: number;
  independents: 'show' | 'hide';
  sort: Sort;
  view: View;
  // The item zoomed into and the one selected, by item id (see `eid`), so they survive regrouping.
  focus: string | null;
  selected: string | null;
};

export type Counts = Record<Level, number>;

// One box in the tree. `eid` names the item it stands for, which can appear in several places (a brand with two
// owners, or in two countries); `id` is its place in the tree, unique.
export type Node = {
  id: string;
  eid: string;
  name: string;
  level: Kind;
  kids: Map<string, Node>;
  parent?: Node;
  group?: ChartGroup;
  // An independent brand standing as its own owner.
  self?: ChartBrand;
  brand?: ChartBrand;
  line?: ChartLine;
  model?: ChartModel;
  ref?: ChartReference;
  // A brand drawn only because a brand it owns is in view.
  context?: boolean;
  // An owner's share of the brand, where it holds part of it.
  share?: number;
  // How many brands a group owns in all, filtered or not.
  total?: number;
  counts: Counts;
  own: number;
  children?: Node[];
  memo?: Record<string, number | undefined>;
};

export type Hit = { eid: string; level: Level; name: string; detail: string; brand?: ChartBrand; group?: ChartGroup; line?: string; model?: string };

// Lookups over the payload, made once.
export function indexPayload(payload: ChartPayload) {
  const groupsById = new Map(payload.groups.map((group) => [group.id, group]));
  const brandsById = new Map(payload.brands.map((brand) => [brand.id, brand]));
  const linesById = new Map(payload.lines.map((line) => [line.id, line]));
  const modelsById = new Map(payload.models.map((model) => [model.id, model]));
  const linesOf = Map.groupBy(payload.lines, (line) => line.brand);
  const modelsOf = Map.groupBy(payload.models, (model) => model.line);
  const groupTotals = new Map<string, number>();
  for (const brand of payload.brands)
    for (const owner of brand.owners) if (!owner.startsWith('brand:')) groupTotals.set(owner, (groupTotals.get(owner) ?? 0) + 1);

  const ownerName = (owner: string) =>
    owner.startsWith('brand:') ? brandsById.get(owner.slice(6))?.name : groupsById.get(owner)?.name;
  const ownerLabel = (brand: ChartBrand) => (brand.owners.length ? brand.owners.map(ownerName).join(', ') : 'Independent');
  const brandOfLine = (lineId: string) => brandsById.get(linesById.get(lineId)!.brand)!;
  const brandOfModel = (model: ChartModel) => brandOfLine(model.line);

  // Everything search can find, at every level.
  const entries: Hit[] = [
    ...payload.groups.map((group): Hit => ({ eid: `g:${group.id}`, level: 'owner', name: group.name, detail: group.country ?? '', group })),
    ...payload.brands.map((brand): Hit => ({
      eid: `b:${brand.id}`,
      level: 'brand',
      name: brand.name,
      detail: [brand.origin, ownerLabel(brand)].filter(Boolean).join(' · '),
      brand,
    })),
    ...payload.lines.map((line): Hit => ({ eid: `l:${line.id}`, level: 'line', name: line.name, detail: brandsById.get(line.brand)!.name, brand: brandsById.get(line.brand), line: line.id })),
    ...payload.models.flatMap((model): Hit[] => {
      const brand = brandOfModel(model);
      const line = linesById.get(model.line)!;
      return [
        { eid: `m:${model.id}`, level: 'model', name: model.name, detail: `${brand.name} · ${line.name}`, brand, line: line.id, model: model.id },
        ...model.references.map((reference): Hit => ({
          eid: refEid(model, reference),
          level: 'ref',
          name: reference.ref,
          detail: `${brand.name} · ${model.name}`,
          brand,
          line: line.id,
          model: model.id,
        })),
      ];
    }),
  ];

  // The ids of an item's natural ancestors, nearest first, to fall back on when it drops out of view.
  const ancestorsOf = (eid: string): string[] => {
    const [kind, rest] = [eid.slice(0, 1), eid.slice(2)];
    if (kind === 'r') return [`m:${rest.split('#')[0]}`, ...ancestorsOf(`m:${rest.split('#')[0]}`)];
    if (kind === 'm') return modelsById.has(rest) ? [`l:${modelsById.get(rest)!.line}`, ...ancestorsOf(`l:${modelsById.get(rest)!.line}`)] : [];
    if (kind === 'l') return linesById.has(rest) ? [`b:${linesById.get(rest)!.brand}`, ...ancestorsOf(`b:${linesById.get(rest)!.brand}`)] : [];
    if (kind === 'b') {
      const brand = brandsById.get(rest);
      if (!brand) return [];
      if (!brand.owners.length) return [`o:${brand.id}`];
      const owner = brand.owners[0];
      return owner.startsWith('brand:') ? [`b:${owner.slice(6)}`, ...ancestorsOf(`b:${owner.slice(6)}`)] : [`g:${owner}`, ...ancestorsOf(`g:${owner}`)];
    }
    if (kind === 'g') {
      const parent = groupsById.get(rest)?.parent;
      return parent ? [`g:${parent}`, ...ancestorsOf(`g:${parent}`)] : [];
    }
    return [];
  };

  return { payload, groupsById, brandsById, linesById, modelsById, linesOf, modelsOf, groupTotals, ownerLabel, brandOfLine, brandOfModel, entries, ancestorsOf };
}
export type Index = ReturnType<typeof indexPayload>;

export const refEid = (model: ChartModel, reference: ChartReference) => `r:${model.id}#${reference.ref}`;

// ---------- filters ----------

export function ownerCountries(index: Index, brand: ChartBrand) {
  if (!brand.owners.length) return brand.origin ? [brand.origin] : [];
  const countries = brand.owners.map((owner) =>
    owner.startsWith('brand:') ? index.brandsById.get(owner.slice(6))?.origin : index.groupsById.get(owner)?.country,
  );
  return [...new Set(countries.filter((country): country is string => !!country))];
}

export function countriesOf(index: Index, brand: ChartBrand, meaning: CountryMeaning): string[] {
  const list =
    meaning === 'origin'
      ? brand.origin ? [brand.origin] : []
      : meaning === 'owner'
        ? ownerCountries(index, brand)
        : meaning === 'hq'
          ? brand.headquarters ? [brand.headquarters] : []
          : brand.madeIn;
  return list.length ? list : [UNRECORDED];
}

export const statusOf = (brand: ChartBrand) => (brand.trading ? 'trading' : 'not-trading');

export function passesFilters(index: Index, state: State, brand: ChartBrand, skipCountry = false) {
  if (!skipCountry && state.countries.size && !countriesOf(index, brand, state.countryMeaning).some((country) => state.countries.has(country))) return false;
  if (state.segments.size && !state.segments.has(brand.segment ?? UNRECORDED)) return false;
  if (state.status.size && !state.status.has(statusOf(brand))) return false;
  if (state.independents === 'hide' && !brand.owners.length) return false;
  return true;
}

// ---------- search ----------

// References are matched ignoring spaces, dots and dashes, so "126610 LN" finds 126610LN.
const squash = (text: string) => text.toLowerCase().replace(/[\s.\-]/g, '');
export function matches(hit: Hit, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (hit.name.toLowerCase().includes(q)) return true;
  return hit.level === 'ref' && squash(q).length > 0 && squash(hit.name).includes(squash(q));
}

export type Search = { hits: Hit[]; keepBrands: Set<string>; marked: Set<string>; wholeBrands: Set<string>; path: Set<string> };

export function search(index: Index, query: string): Search | null {
  if (!query.trim()) return null;
  const hits = index.entries.filter((hit) => matches(hit, query));
  const keepBrands = new Set<string>();
  const wholeBrands = new Set<string>();
  const path = new Set<string>();
  for (const hit of hits) {
    if (hit.level === 'owner') {
      for (const brand of index.payload.brands)
        if (brand.owners.includes(hit.group!.id)) {
          keepBrands.add(brand.id);
          wholeBrands.add(brand.id);
        }
    } else if (hit.level === 'brand') {
      keepBrands.add(hit.brand!.id);
      wholeBrands.add(hit.brand!.id);
    } else {
      keepBrands.add(hit.brand!.id);
      path.add(`l:${hit.line}`);
      if (hit.model) path.add(`m:${hit.model}`);
    }
  }
  return { hits, keepBrands, marked: new Set(hits.map((hit) => hit.eid)), wholeBrands, path };
}

// ---------- building ----------

const emptyCounts = (): Counts => ({ owner: 0, brand: 0, line: 0, model: 0, ref: 0 });
const makeNode = (id: string, eid: string, name: string, level: Kind, extra: Partial<Node> = {}): Node => ({
  id,
  eid,
  name,
  level,
  kids: new Map(),
  counts: emptyCounts(),
  own: 0,
  ...extra,
});
function child(parent: Node, key: string, eid: string, name: string, level: Kind, extra: Partial<Node> = {}) {
  let node = parent.kids.get(key);
  if (!node) {
    node = makeNode(`${parent.id}/${key}`, eid, name, level, extra);
    node.parent = parent;
    parent.kids.set(key, node);
  }
  return node;
}
export const levelIndex = (node: { level: Kind }) => LEVELS.indexOf(node.level as Level);

export type Built = {
  root: Node;
  top: HierarchyNode<Node>;
  shown: number;
  search: Search | null;
};

// Builds the tree for the current state. `keep` is an item id kept as a box even when its level is outside the range,
// so the item zoomed into stays the frame.
export function build(index: Index, state: State, to: number, keep: string | null): Built {
  const found = search(index, state.q);
  const root = makeNode('root', 'root', 'All', 'root');
  const { brandsById, groupsById, linesOf, modelsOf } = index;

  const lensKeys = (brand: ChartBrand): (string | null)[] => {
    if (state.groupBy === 'country') {
      const list = countriesOf(index, brand, state.countryMeaning).map((country) => (country === UNRECORDED ? NOT_RECORDED : country));
      return state.countries.size ? list.filter((country) => state.countries.has(country === NOT_RECORDED ? UNRECORDED : country)) : list;
    }
    if (state.groupBy === 'segment') return [segmentName(brand.segment)];
    if (state.groupBy === 'era') return [eraOf(brand.founded)];
    return [null];
  };
  const ensureOwner = (parent: Node, owner: string, brand: ChartBrand): Node => {
    // An independent brand is its own owner, so it appears in the Owner column under its own name.
    if (owner === '') return child(parent, `g:self:${brand.id}`, `o:${brand.id}`, brand.name, 'owner', { self: brand });
    const group = groupsById.get(owner)!;
    const host = group.parent ? ensureOwner(parent, group.parent, brand) : parent;
    return child(host, `g:${owner}`, `g:${owner}`, group.name, 'owner', { group });
  };
  const addProducts = (node: Node, brand: ChartBrand) => {
    const limited = found && !found.wholeBrands.has(brand.id);
    for (const line of linesOf.get(brand.id) ?? []) {
      if (limited && !found.path.has(`l:${line.id}`)) continue;
      const lineNode = child(node, `l:${line.id}`, `l:${line.id}`, line.name, 'line', { line });
      for (const model of modelsOf.get(line.id) ?? []) {
        if (limited && !found.path.has(`m:${model.id}`) && !found.marked.has(`l:${line.id}`)) continue;
        const modelNode = child(lineNode, `m:${model.id}`, `m:${model.id}`, model.name, 'model', { model });
        for (const reference of model.references) child(modelNode, `r:${reference.ref}`, refEid(model, reference), reference.ref, 'ref', { ref: reference, model });
      }
    }
  };
  // A brand held by another brand sits inside that brand's box; the owning brand is drawn as context if filtered out.
  const ensureBrand = (parent: Node, brand: ChartBrand, owner: string, share: number | undefined, shown: boolean): Node => {
    let host: Node;
    if (owner.startsWith('brand:')) {
      const above = brandsById.get(owner.slice(6))!;
      host = ensureBrand(parent, above, above.owners[0] ?? '', undefined, false);
    } else host = ensureOwner(parent, owner, brand);
    const node = child(host, `b:${brand.id}`, `b:${brand.id}`, brand.name, 'brand', { brand, context: true });
    if (shown) {
      node.context = false;
      node.share = share;
      addProducts(node, brand);
    }
    return node;
  };

  let shown = 0;
  for (const brand of index.payload.brands) {
    if (!passesFilters(index, state, brand)) continue;
    if (found && !found.keepBrands.has(brand.id)) continue;
    shown++;
    const owners = brand.owners.length ? brand.owners : [''];
    const shares = owners.map((_, i) => {
      const stake = brand.stakes?.[i];
      return typeof stake === 'number' ? stake / 100 : undefined;
    });
    for (const key of lensKeys(brand)) {
      const parent = key === null ? root : child(root, `c:${key}`, `c:${key}`, key, 'lens');
      owners.forEach((owner, i) => ensureBrand(parent, brand, owner, shares[i], true));
    }
  }

  count(root, index);
  const trimmed = trim(root, state.from, to, keep);
  const topNode = trimmed[0] ?? Object.assign(root, { children: [] });
  const top = hierarchy(topNode, (node) => (node.children?.length ? node.children : null)).sort((a, b) => compare(a.data, b.data, state));
  return { root, top, shown, search: found };
}

// Counts distinct items, so a brand with two owners, or in two countries, counts once.
function count(node: Node, index: Index): Record<Level, Set<string>> {
  const sets = { owner: new Set<string>(), brand: new Set<string>(), line: new Set<string>(), model: new Set<string>(), ref: new Set<string>() };
  if (node.level === 'brand' ? !node.context : node.level in sets) sets[node.level as Level].add(node.eid);
  for (const kid of node.kids.values()) {
    const below = count(kid, index);
    for (const level of LEVELS) for (const eid of below[level]) sets[level].add(eid);
  }
  if (node.level === 'owner' && node.group) node.total = index.groupTotals.get(node.group.id) ?? 0;
  node.counts = Object.fromEntries(LEVELS.map((level) => [level, sets[level].size])) as Counts;
  return sets;
}

// Cuts the tree to the levels from `from` to `to`: deeper boxes are dropped, and boxes above `from` hand their
// children up to their parent. A box is kept if it is the deepest shown, or holds something that is.
function trim(node: Node, from: number, to: number, keep: string | null): Node[] {
  const all = [...node.kids.values()];
  const kids = all.filter((kid) => levelIndex(kid) <= to).flatMap((kid) => trim(kid, from, to, keep));
  node.own = levelIndex(node) >= 0 && !(node.level === 'brand' && node.context) && !kids.some((kid) => levelIndex(kid) > levelIndex(node)) ? 1 : 0;
  node.children = kids;
  if (levelIndex(node) >= 0 && levelIndex(node) < from && node.eid !== keep) return kids;
  if (!(node.own > 0) && !kids.length) return [];
  return [node];
}

// ---------- measures and sorting ----------

export const SORTS: { id: Sort; label: string }[] = [
  { id: 'models', label: 'Most models' },
  { id: 'count', label: 'Most references' },
  { id: 'brands', label: 'Most brands' },
  { id: 'age', label: 'Oldest first' },
  { id: 'revenue', label: 'Highest revenue' },
  { id: 'production', label: 'Most watches made' },
  { id: 'price', label: 'Highest average price' },
  { id: 'name', label: 'Name, A to Z' },
];

export const usd = (value: number) =>
  value >= 1e9 ? `$${(value / 1e9).toFixed(1)}B` : value >= 1e6 ? `$${Math.round(value / 1e6)}M` : `$${Math.round(value).toLocaleString('en-US')}`;

type Measure = { descending: boolean; format: (value: number, node: Node) => string; missing: string };
const MEASURES: Partial<Record<Sort, Measure>> = {
  brands: { descending: true, format: (value) => `${value} brand${value === 1 ? '' : 's'}`, missing: 'no brands' },
  age: {
    descending: false,
    format: (value, node) => (node.level === 'ref' ? `${value}` : node.level === 'brand' || node.level === 'owner' ? `Est. ${value}` : `Since ${value}`),
    missing: 'no date recorded',
  },
  revenue: { descending: true, format: usd, missing: 'no revenue recorded' },
  production: {
    descending: true,
    format: (value) => `${value >= 1e6 ? +(value / 1e6).toFixed(1) + 'M' : value >= 1e3 ? Math.round(value / 1e3) + 'k' : value} a year`,
    missing: 'no production recorded',
  },
  price: { descending: true, format: (value) => `avg ${usd(value)}`, missing: 'no prices recorded' },
};

const walk = (node: Node, visit: (node: Node) => void) => {
  visit(node);
  for (const kid of node.kids.values()) walk(kid, visit);
};
const sum = (values: number[]) => (values.length ? values.reduce((total, value) => total + value, 0) : undefined);
const min = (values: (number | undefined)[]) => {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length ? Math.min(...known) : undefined;
};

// A box's figure for a measure, taken from the whole tree, so an owner's figure covers its brands even when the
// Brand level isn't shown.
export function measure(node: Node, sort: Sort): number | undefined {
  const memo = (node.memo ??= {});
  if (sort in memo) return memo[sort];
  const brands: ChartBrand[] = [];
  const refs: ChartReference[] = [];
  const lines: ChartLine[] = [];
  walk(node, (item) => {
    if (item.level === 'brand' && !item.context) brands.push(item.brand!);
    if (item.level === 'ref') refs.push(item.ref!);
    if (item.level === 'line') lines.push(item.line!);
  });
  const top = ['owner', 'brand', 'lens'].includes(node.level);
  let value: number | undefined;
  if (sort === 'brands') value = node.counts.brand || undefined;
  if (sort === 'age')
    value =
      node.level === 'ref'
        ? node.ref!.since
        : node.level === 'line' || node.level === 'model'
          ? min([...lines.map((line) => line.since), ...refs.map((ref) => ref.since)])
          : min(brands.map((brand) => brand.founded));
  if (sort === 'revenue')
    value = node.level === 'owner' && node.group?.revenue ? node.group.revenue : top ? sum(brands.flatMap((brand) => (brand.revenue ? [brand.revenue] : []))) : undefined;
  if (sort === 'production') value = top ? sum(brands.flatMap((brand) => (brand.production ? [brand.production] : []))) : undefined;
  if (sort === 'price') {
    const prices = refs.flatMap((ref) => (ref.price ? [ref.price] : []));
    value = prices.length ? sum(prices)! / prices.length : undefined;
  }
  return (memo[sort] = value);
}

// The figure printed in a box for the chosen sort, or what's missing.
export function measureText(node: Node, sort: Sort) {
  const m = MEASURES[sort];
  if (!m || node.level === 'root') return '';
  const value = measure(node, sort);
  return value === undefined ? m.missing : m.format(value, node);
}

export function compare(a: Node, b: Node, state: State) {
  if (a.level === 'lens' && b.level === 'lens') {
    if (state.groupBy === 'era') return ERAS.indexOf(a.name) - ERAS.indexOf(b.name);
    if (a.name === NOT_RECORDED) return 1;
    if (b.name === NOT_RECORDED) return -1;
  }
  if (state.sort === 'name') return a.name.localeCompare(b.name);
  // How much is catalogued under each box: by references or by models first, the other levels breaking ties.
  if (state.sort === 'count' || state.sort === 'models') {
    const order = state.sort === 'count' ? (['ref', 'model', 'line', 'brand'] as const) : (['model', 'ref', 'line', 'brand'] as const);
    for (const level of order) {
      const diff = b.counts[level] - a.counts[level];
      if (diff) return diff;
    }
  }
  const m = MEASURES[state.sort];
  if (m) {
    const va = measure(a, state.sort);
    const vb = measure(b, state.sort);
    // Boxes with no figure go last.
    if (va === undefined || vb === undefined) {
      const diff = Number(va === undefined) - Number(vb === undefined);
      if (diff) return diff;
    } else if (va !== vb) return m.descending ? vb - va : va - vb;
  }
  return a.name.localeCompare(b.name);
}

// A box's counts in words: its brands, and whatever it holds below.
export function describe(node: Node) {
  const c = node.counts;
  const out: string[] = [];
  const many = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
  if (node.level === 'owner' && node.self) out.push(c.brand > 1 ? `Independent · ${many(c.brand, 'brand')}` : 'Independent');
  else if (node.level === 'owner' && node.group && node.total) out.push(c.brand < node.total ? `${c.brand} of ${many(node.total, 'brand')}` : many(c.brand, 'brand'));
  else if (['root', 'lens', 'owner'].includes(node.level)) out.push(many(c.brand, 'brand'));
  const at = levelIndex(node);
  if (c.line && at < 2) out.push(many(c.line, 'line'));
  if (c.model && at < 3) out.push(many(c.model, 'model'));
  if (c.ref && at < 4) out.push(many(c.ref, 'ref'));
  return out.join(' · ');
}
