import { hierarchy, pack, treemap, treemapSquarify, type HierarchyNode, type HierarchyRectangularNode } from 'd3-hierarchy';
import { isDark, logoFill, logoReads, pickLogo, type LogoFile, type LogoSet } from './logo';
import { metrics, type Metric } from './metrics';

export type { LogoFile } from './logo';

// Everything here works on plain data, with no content collections, so the page can run the same layout
// again in the browser when a reader regroups, resizes or filters the chart.

// The layout is worked out in this box and drawn in percentages, so it scales with the page. Circles pack into
// one round shape, so they get a square box; rectangles a wide one.
export type Box = { width: number; height: number };
export const boxFor = (shape: Shape): Box => (shape === 'circles' ? { width: 1000, height: 1000 } : { width: 1000, height: 600 });
// Room at the top of each bucket for its name, given only where the bucket is big enough to spare it.
const header = 20;

// A brand as the chart sees it.
export type Point = {
  id: string;
  name: string;
  href: string;
  // Its logo and the parts cropped from it, shown by the rules in src/lib/logo.ts.
  logos: LogoSet;
  // The bucket it sits in under each grouping, by grouping id. Several for a brand with part-owners.
  buckets: Record<string, string[]>;
  // The group making it under license. For a measure that counts licensed brands, it sits there instead of with its owner.
  licensee?: string;
  // The stakes of its part-owners, by bucket key under the owner grouping: a percentage, or `unknown`.
  stakes?: Record<string, number | 'unknown'>;
  // Figures by measure id, only where known.
  values: Record<string, number>;
  captions: Record<string, string>;
};

// One box in a grouping: a group, a country, a segment.
export type Bucket = {
  key: string;
  name: string;
  href?: string;
  // The logo of the group or brand the bucket stands for, if it has one.
  logos?: Point['logos'];
  // The bucket's own figure by measure id, where it has one beyond its brands', e.g. a group's whole revenue.
  values?: Record<string, number>;
  // For brands with no value recorded for the grouping, or none that makes a useful box (no owning group),
  // how they are described in the list under the chart, e.g. `with no nation of origin recorded`.
  // They are listed there rather than drawn, since a gap in the data would otherwise be the biggest box.
  aside?: string;
};

export type Grouping = {
  id: string;
  label: string;
  // Only brands in these buckets are drawn. A grouping that leaves a bucket out drops its brands.
  buckets: Bucket[];
  // Whether brands made under license move to the group that makes them, for measures that count them.
  licensing?: boolean;
  // Whether brands' `stakes` are keyed by this grouping's buckets, so a part-owner can count only its stake.
  stakes?: boolean;
};

export type ChartData = { points: Point[]; groupings: Grouping[] };

export type Options = {
  grouping: string;
  size: string;
  // Whether a bucket's own figure beyond its brands' is drawn as a block of its own.
  otherBusiness?: boolean;
  // Whether a part-owned brand counts toward each owner by only that owner's stake, for a measure that allows it.
  byStake?: boolean;
  // Brands left in by the page's filters; all of them when unset.
  visible?: Set<string>;
  // The bucket zoomed into, showing its brands alone.
  zoom?: string;
  // Drawn as nested rectangles (a treemap), or as nested circles packed together.
  shape?: Shape;
};

export type Shape = 'rects' | 'circles';

// What the chart shows:
// - `buckets`: one box per bucket, for a measure that is the same for every brand (a count), which says
//   nothing about the brands themselves.
// - `nested`: buckets holding their brands, for a measure that differs by brand and adds up. Circles always nest,
//   a count drawing every brand the same size, so each bucket shows the brands in it.
// - `zoomed`: the brands of one bucket, for any measure that differs by brand, since nothing is summed across buckets.
export type Mode = 'buckets' | 'nested' | 'zoomed';

export type Cell = {
  kind: 'bucket' | 'tile' | 'brand' | 'other';
  // Its box, or for a circle the square it is drawn in.
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  bucket: Bucket;
  point?: Point;
  licensed?: boolean;
  // The bucket's stake in a part-owned brand, where the measure can be split by stake.
  stake?: number | 'unknown';
  // Room was left for the bucket's name.
  named?: boolean;
  // A tile's brands, those with logos first, to show inside it.
  preview?: Point[];
};

export type Layout = {
  options: Options;
  mode: Mode;
  shape: Shape;
  box: Box;
  grouping: Grouping;
  // The bucket zoomed into, unless the grouping has only one.
  zoomed?: Bucket;
  size: Metric;
  cells: Cell[];
  // Brands drawn, and brands in these buckets with no figure for the size measure.
  shown: number;
  missing: number;
  // When zoomed, the brands with no figure for the size measure, so they can still be listed.
  unsized: Point[];
  // Brands in a set-aside bucket, listed under the chart, with how they are described.
  unrecorded: Point[];
  aside?: string;
  // Brands made under license that a measure of what a group owns does not count toward the maker.
  hiddenLicensed: number;
  // Brands drawn under a part-owner, which the stake option would change.
  partOwned: number;
  // Each bucket's total for the size measure, including its own figure where shown.
  totals: Record<string, number>;
};

export const metricById = (id: string) => metrics.find((metric) => metric.id === id) ?? metrics[0];

// The bucket shown alone: the one zoomed into, or the only one a grouping has.
export const zoomedBucket = (grouping: Grouping, zoom?: string) =>
  grouping.buckets.length === 1 ? grouping.buckets[0] : grouping.buckets.find((bucket) => bucket.key === zoom);

// Which measures can size the chart in each mode: a measure that adds up across buckets at the top,
// and one that differs by brand inside a bucket.
export const sizesFor = (zoomed: boolean) => metrics.filter((metric) => (zoomed ? !metric.uniform : metric.additive));

type Datum =
  | { kind: 'root'; children: Datum[] }
  | { kind: 'bucket'; bucket: Bucket; children: Datum[] }
  | { kind: 'tile'; bucket: Bucket; value: number; points: Point[] }
  | { kind: 'brand'; point: Point; value: number; licensed: boolean; stake?: number | 'unknown' }
  | { kind: 'other'; bucket: Bucket; value: number };

export function layoutTreemap(data: ChartData, options: Options): Layout {
  const grouping = data.groupings.find((candidate) => candidate.id === options.grouping) ?? data.groupings[0];
  const zoomed = zoomedBucket(grouping, options.zoom);
  // A measure that cannot size this mode falls back to the first that can.
  const allowed = sizesFor(Boolean(zoomed));
  const size = allowed.find((metric) => metric.id === options.size) ?? allowed.find((metric) => metric.id === 'age') ?? allowed[0];
  const shape = options.shape ?? 'rects';
  const box = boxFor(shape);
  const mode: Mode = zoomed ? 'zoomed' : size.uniform && shape === 'rects' ? 'buckets' : 'nested';
  const moveLicensed = Boolean(grouping.licensing && size.includesLicensed);
  const buckets = zoomed ? [zoomed] : grouping.buckets.filter((bucket) => !bucket.aside);
  const bucketKeys = new Set(buckets.map((bucket) => bucket.key));
  const setAside = zoomed ? undefined : grouping.buckets.find((bucket) => bucket.aside);
  const unrecorded: Point[] = [];

  const members = new Map<string, { point: Point; licensed: boolean }[]>();
  let hiddenLicensed = 0;
  for (const point of data.points) {
    if (options.visible && !options.visible.has(point.id)) continue;
    const licensed = moveLicensed && point.licensee !== undefined;
    const keys = licensed ? [point.licensee!] : (point.buckets[grouping.id] ?? []);
    if (setAside && keys.includes(setAside.key)) unrecorded.push(point);
    if (grouping.licensing && !size.includesLicensed && point.licensee && bucketKeys.has(point.licensee)) hiddenLicensed++;
    for (const key of keys) {
      if (!bucketKeys.has(key)) continue;
      if (!members.has(key)) members.set(key, []);
      members.get(key)!.push({ point, licensed });
    }
  }

  // Counted once each, though a brand with part-owners sits in several buckets.
  const drawn = new Set<string>();
  const partOwned = new Set<string>();
  const splits = Boolean(grouping.stakes && size.byStake && mode !== 'buckets');
  const missing = new Map<string, Point>();
  const children: Datum[] = [];
  for (const bucket of buckets) {
    const brands: Datum[] = [];
    for (const { point, licensed } of members.get(bucket.key) ?? []) {
      const value = point.values[size.id];
      if (value === undefined || value <= 0) {
        missing.set(point.id, point);
        continue;
      }
      const stake = splits && !licensed ? point.stakes?.[bucket.key] : undefined;
      if (stake !== undefined) partOwned.add(point.id);
      // A stake that isn't public leaves the brand counted in full.
      const share = options.byStake && typeof stake === 'number' ? stake / 100 : 1;
      brands.push({ kind: 'brand', point, value: value * share, licensed, stake });
      drawn.add(point.id);
    }
    if (brands.length === 0) continue;
    if (mode === 'buckets') {
      const points = brands.map((brand) => (brand as Extract<Datum, { kind: 'brand' }>).point);
      children.push({ kind: 'tile', bucket, value: brands.length, points });
      continue;
    }
    const brandTotal = brands.reduce((total, child) => total + (child.kind === 'brand' ? child.value : 0), 0);
    const own = options.otherBusiness && size.additive ? bucket.values?.[size.id] : undefined;
    if (own !== undefined && own > brandTotal) brands.push({ kind: 'other', bucket, value: own - brandTotal });
    children.push({ kind: 'bucket', bucket, children: brands });
  }

  const root = hierarchy<Datum>({ kind: 'root', children }, (d) => ('children' in d ? d.children : undefined))
    .sum((d) => ('value' in d ? d.value : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  // Each node's box: as laid out by the treemap, or the square around its circle, packed into one circle as tall as the chart.
  let placed: { node: HierarchyNode<Datum>; x: number; y: number; width: number; height: number }[];
  let roomy: (box: { width: number; height: number }) => boolean;
  if (shape === 'circles') {
    // A circle's name sits across its top, so a bucket circle needs to be wide enough there to hold it.
    roomy = ({ width }) => mode === 'nested' && width > 90;
    // A margin round the whole, since bucket labels straddle the top edge of their circles, and a ring inside each
    // bucket so its label sits mostly clear of its brands.
    const margin = mode === 'zoomed' ? 0 : 24;
    placed = pack<Datum>()
      .size([box.width - 2 * margin, box.height - 2 * margin])
      .padding((node) => (node.depth === 0 ? 6 : node.depth === 1 && mode === 'nested' ? 8 : 2))(root)
      .descendants()
      .map((node) => ({ node, x: node.x - node.r + margin, y: node.y - node.r + margin, width: 2 * node.r, height: 2 * node.r }));
  } else {
    roomy = ({ width, height }) => mode === 'nested' && height > 48 && width > 56;
    const span = (node: HierarchyRectangularNode<Datum>) => ({ width: node.x1 - node.x0, height: node.y1 - node.y0 });
    placed = treemap<Datum>()
      .tile(treemapSquarify)
      .size([box.width, box.height])
      .paddingOuter(mode === 'zoomed' ? 0 : 3)
      .paddingInner(2)
      .paddingTop((node) => (node.depth === 1 && roomy(span(node)) ? header : mode === 'zoomed' ? 0 : 3))(root)
      .descendants()
      .map((node) => ({ node, x: node.x0, y: node.y0, ...span(node) }));
  }

  const totals: Record<string, number> = {};
  const cells = placed.flatMap(({ node, ...where }): Cell[] => {
    const d = node.data;
    if (d.kind === 'root') return [];
    const geometry = { ...where, value: node.value ?? 0 };
    if (d.kind === 'tile') {
      totals[d.bucket.key] = d.value;
      // Brands with logos lead the preview, then the rest, each in alphabetical order.
      const preview = [...d.points].sort((a, b) => Number(Boolean(b.logos.whole)) - Number(Boolean(a.logos.whole)) || a.name.localeCompare(b.name));
      return [{ kind: 'tile', ...geometry, bucket: d.bucket, preview }];
    }
    if (d.kind === 'bucket') {
      totals[d.bucket.key] = node.value ?? 0;
      // A zoomed bucket is the whole chart, so it needs no box of its own.
      return mode === 'zoomed' ? [] : [{ kind: 'bucket', ...geometry, bucket: d.bucket, named: roomy(where) }];
    }
    const bucket = (node.parent!.data as Extract<Datum, { kind: 'bucket' }>).bucket;
    if (d.kind === 'other') return [{ kind: 'other', ...geometry, bucket }];
    return [{ kind: 'brand', ...geometry, bucket, point: d.point, licensed: d.licensed, stake: d.stake }];
  });

  return {
    options,
    mode,
    shape,
    box,
    grouping,
    zoomed: grouping.buckets.length > 1 ? zoomed : undefined,
    size,
    cells,
    shown: drawn.size,
    missing: missing.size,
    unsized: mode === 'zoomed' ? [...missing.values()].sort((a, b) => a.name.localeCompare(b.name)) : [],
    unrecorded: unrecorded.sort((a, b) => a.name.localeCompare(b.name)),
    aside: setAside?.aside,
    hiddenLicensed,
    partOwned: partOwned.size,
    totals,
  };
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const pct = (value: number, of: number) => `${((value / of) * 100).toFixed(3)}%`;
const position = ({ x, y, width, height }: Cell, box: Box) =>
  `left:${pct(x, box.width)};top:${pct(y, box.height)};width:${pct(width, box.width)};height:${pct(height, box.height)}`;

// What fits in a cell, judged in layout units (about a pixel each at full width).
const showsLogo = ({ width, height }: Cell) => width >= 70 && height >= 40;

// The version of a logo shown in a space, where one reads there; otherwise the name stands in.
const shownLogo = (logos: Point['logos'], width: number, height: number) => {
  const logo = pickLogo(logos, width, height);
  return logo && logoReads(logos, logo, width, height) ? logo : undefined;
};
const showsName = ({ width, height }: Cell) => width >= 46 && height >= 16;

// The lines of a brand's tooltip: name, then where it sits, then its figures.
const tipLines = (cell: Cell, layout: Layout) => {
  const point = cell.point!;
  const lines = [point.name + (cell.licensed ? ' (made under license)' : '')];
  if (cell.bucket.name) lines.push(cell.bucket.name);
  lines.push(`${layout.size.label}: ${layout.size.format(cell.value)}`);
  const owner = cell.bucket.name;
  if (cell.stake === 'unknown') lines.push(`${owner}’s stake isn’t public, so it’s counted in full`);
  else if (cell.stake !== undefined && layout.options.byStake) lines.push(`${owner}’s ${cell.stake}% stake of ${layout.size.format(point.values[layout.size.id])}`);
  else if (cell.stake !== undefined) lines.push(`${owner} holds ${cell.stake}%`);
  const caption = point.captions[layout.size.id];
  if (caption) lines.push(caption);
  return lines;
};

// A name's width in ems, estimated per character for the page's sans-serif, since the build cannot measure text.
const charWidth = (char: string) =>
  /[iljtf.,'’!|:;]/.test(char) ? 0.3 : /[r ()-]/.test(char) ? 0.36 : /[mwMW@]/.test(char) ? 0.86 : /[A-Z&]/.test(char) ? 0.68 : /[0-9]/.test(char) ? 0.56 : 0.54;
const textWidth = (text: string) => [...text].reduce((total, char) => total + charWidth(char), 0);
const lineHeight = 1.15;

// The largest type, between `min` and `max` pixels, that sets a name in a `width` by `height` pixel space: on one
// line, or broken at a space onto two where that allows type noticeably larger. None if it cannot fit at `min`.
export function fitName(name: string, width: number, height: number, max: number, min = 9) {
  // A margin for error in the width estimate.
  const room = width * 0.92;
  let best: { size: number; lines: string[] } | undefined;
  const single = Math.min(max, room / textWidth(name), height / lineHeight);
  if (single >= min) best = { size: single, lines: [name] };
  const words = name.split(' ');
  for (let index = 1; index < words.length; index++) {
    const lines = [words.slice(0, index).join(' '), words.slice(index).join(' ')];
    const size = Math.min(max, room / Math.max(...lines.map(textWidth)), height / (2 * lineHeight));
    if (size >= min && (!best || size > best.size * 1.15)) best = { size, lines };
  }
  return best && { size: Math.floor(best.size * 10) / 10, lines: best.lines };
}

// A name set to fit its space, or cut short with an ellipsis at the smallest size where it cannot.
const fittedName = (name: string, width: number, height: number, max: number, extraClass = '') => {
  const fit = fitName(name, width, height, max);
  const classes = ['fit', extraClass].filter(Boolean).join(' ');
  return fit
    ? `<span class="${classes}" style="font-size:${fit.size}px">${fit.lines.map(escape).join('<br>')}</span>`
    : `<span class="${classes} cut" style="font-size:9px">${escape(name)}</span>`;
};

// The grid of plates for `count` brands in a space `width` by `height` pixels: the largest plates, kept near the
// shape of a wordmark, that fit them all; or where even the smallest do not, as many of the smallest as fit.
const plate = { minWidth: 50, minHeight: 26, maxHeight: 72, gap: 4, aspect: 2.4 };
function plateGrid(width: number, height: number, count: number) {
  const none = { columns: 0, rows: 0, width: 0, height: 0 };
  if (count === 0 || width < plate.minWidth || height < plate.minHeight) return none;
  let best = none;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = (width - (columns - 1) * plate.gap) / columns;
    const cellHeight = (height - (rows - 1) * plate.gap) / rows;
    // Plates keep near a wordmark's shape, so the smaller of the two sides decides their size.
    const plateHeight = Math.min(cellHeight, cellWidth / plate.aspect, plate.maxHeight);
    if (plateHeight < plate.minHeight || cellWidth < plate.minWidth) continue;
    if (plateHeight > best.height) best = { columns, rows, width: Math.min(cellWidth, plateHeight * plate.aspect * 1.6), height: plateHeight };
  }
  // The plates then take up the height they were chosen for, a little taller than their shape asks where that
  // leaves room, so the grid fills the space rather than stopping short of it.
  if (best.columns > 0) {
    const cellHeight = (height - (best.rows - 1) * plate.gap) / best.rows;
    return { ...best, height: Math.min(cellHeight, best.height * 1.6) };
  }
  // Too many to show at the smallest size: fill the space with the smallest plates, and say how many are left.
  const columns = Math.floor((width + plate.gap) / (plate.minWidth + plate.gap));
  const rows = Math.floor((height + plate.gap) / (plate.minHeight + plate.gap));
  // Too few plates to show any brands beside the "more" plate is not worth drawing.
  if (columns * rows < 3) return none;
  return { columns, rows, width: (width - (columns - 1) * plate.gap) / columns, height: plate.minHeight };
}

// The lines of a whole bucket's tooltip. Its brands are counted in a badge by its name, so this gives the sizing
// figure, and the count too where the size is not the count.
const tileLines = ({ bucket, value, preview = [] }: Cell, layout: Layout) => {
  const count = preview.length;
  const lines = [bucket.name, layout.size.format(value)];
  if (layout.size.id !== 'brands') lines.splice(1, 0, `${count} brand${count === 1 ? '' : 's'}`);
  lines.push('Click to see its brands');
  return lines;
};

// A bucket drawn whole: its name, its count, and a few of its brands' logos.
function renderTile(cell: Cell, layout: Layout, scale: number) {
  const { bucket, preview = [] } = cell;
  const count = preview.length;
  const lines = tileLines(cell, layout);
  // A tile narrower or shorter than its padding would be widened by it, past the edge of the chart.
  const tight = cell.width < 30 || cell.height < 30;
  const classes = ['tile', tight && 'tight'].filter(Boolean).join(' ');
  const style = position(cell, layout.box);
  // Its brands sit in a grid of plates below the name, a logo where there is one and the name where not.
  // The plates grow to fill the tile when it has few brands, and shrink no smaller than 50 by 26px (room for a
  // name on two lines) when it has many, where the last plate says how many more there are. Plates are sized
  // in pixels, so this is worked out at the size the chart is drawn: the tile's padding and border take 18px
  // across, and with its name and its spacing about 46px down.
  const grid = plateGrid(cell.width * scale - 18, cell.height * scale - 46, preview.length);
  const room = grid.columns * grid.rows;
  const shown = preview.length > room ? preview.slice(0, Math.max(0, room - 1)) : preview;
  const more = preview.length - shown.length;
  // A plate's logo is drawn inside its padding: 8% of its width each side and 6% of its height top and bottom.
  const plates = shown.map((point) => {
    const logo = shownLogo(point.logos, grid.width * 0.84, grid.height * 0.88);
    const fill = fillOf(point.logos, logo);
    const classes = classList('plate', !logo && 'named', fill.dark && 'on-dark');
    return logo
      ? `<span class="${classes}" style="${fill.style}"><img src="${escape(logo.src)}" alt="" loading="lazy"></span>`
      : `<span class="${classes}" style="${fill.style}">${fittedName(point.name, grid.width - 8, grid.height - 4, Math.min(18, grid.height * 0.45))}</span>`;
  });
  if (room > 0 && more > 0) plates.push(`<span class="plate more">+${more} more</span>`);
  const gridStyle = `grid-template-columns:repeat(${grid.columns},${grid.width.toFixed(1)}px);grid-auto-rows:${grid.height.toFixed(1)}px;--plate-font:${Math.min(16, Math.max(10, grid.height * 0.38)).toFixed(1)}px`;
  const roomForName = cell.width >= 40 && cell.height >= 22;
  return (
    `<button type="button" class="${classes}" style="${style}" data-zoom="${escape(bucket.key)}" aria-label="${escape(lines.join(', '))}" data-tip="${escape(lines.join('\n'))}">` +
    (roomForName ? `<span class="tile-head"><span class="tile-badge">${count}</span><span class="tile-name">${escape(bucket.name)}</span></span>` : '') +
    (plates.length > 0 ? `<span class="tile-logos" style="${gridStyle}">${plates.join('')}</span>` : '') +
    `</button>`
  );
}

// A brand's name set in its cell at the largest type that fits, up to 15px: across, or up the side of a narrow,
// tall cell where that fits it larger. Nothing where neither fits even small.
function brandName(name: string, width: number, height: number) {
  if (width < 12 || height < 10) return '';
  const across = fitName(name, width, height, 15);
  const up = height > width * 1.4 ? fitName(name, height, width, 15) : undefined;
  if (up && (!across || up.size > across.size * 1.15)) return fittedName(name, height, width, 15, 'vertical');
  return across ? fittedName(name, width, height, 15) : width >= 30 && height >= 12 ? fittedName(name, width, height, 15) : '';
}

// A brand's initials, for a circle too small for its name: the first letter of up to three of its words.
export const initials = (name: string) =>
  name
    .split(/[\s\-–]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0].toUpperCase())
    .join('');

// A brand's initials sized to fill a circle's inner square, or nothing where even they would not read.
function brandInitials(name: string, inner: number) {
  const letters = initials(name);
  if (!letters || inner < 12) return '';
  const size = Math.min(16, (inner * 0.9) / (letters.length * 0.65), inner * 0.7);
  return size < 7 ? '' : `<span class="fit initials" style="font-size:${size.toFixed(1)}px">${escape(letters)}</span>`;
}

const classList = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

// The largest box of a logo's shape that fits in a circle `diameter` across, kept a little inside its edge.
const inCircle = (logo: LogoFile, diameter: number, margin = 0.8) => {
  const aspect = logo.width / logo.height;
  const diagonal = Math.hypot(aspect, 1);
  return { width: (diameter * margin * aspect) / diagonal, height: (diameter * margin) / diagonal };
};

// A brand's logo in its circle: the whole logo where its name reads, or else its name or symbol alone where that
// reads, by the same rules as anywhere else. Where none of them reads, nothing, so the circle shows the brand's name
// or initials instead. Sized as a share of the circle, so it scales with the chart.
function circleLogo(logos: Point['logos'], diameter: number) {
  if (!logos.whole) return undefined;
  const room = inCircle(logos.whole, diameter);
  const logo = pickLogo(logos, room.width, room.height);
  if (!logo) return undefined;
  const box = inCircle(logo, diameter);
  return logoReads(logos, logo, box.width, box.height) ? circleImage(logo) : undefined;
}

const circleImage = (logo: LogoFile) => {
  const fit = inCircle(logo, 1);
  const html = `<img src="${escape(logo.src)}" alt="" loading="lazy" style="width:${(fit.width * 100).toFixed(1)}%;height:${(fit.height * 100).toFixed(1)}%">`;
  return { logo, html };
};

// A bucket circle's label across its top: its logo on its fill where it has one that reads there,
// and otherwise its name.
function bucketLabel(cell: Cell, scale: number) {
  const { bucket } = cell;
  const diameter = cell.width * scale;
  const label = `aria-label="${escape(`Zoom into ${bucket.name}`)}" data-zoom="${escape(bucket.key)}"`;
  const height = Math.min(44, Math.max(18, diameter * 0.1));
  // The label is centered on the circle's top edge, so its foot sits half its height inside; it keeps within the
  // chord there.
  const foot = height / 2 + 4;
  const chord = 2 * Math.sqrt(Math.max(0, foot * (diameter - foot)));
  const width = Math.min(diameter * 0.5, chord * 0.9);
  // Below 24px tall a group's logo is too small to read, so the name stands in for it.
  const logo = bucket.logos && height >= 24 ? shownLogo(bucket.logos, width - 12, height - 6) : undefined;
  if (logo) {
    const fill = fillOf(bucket.logos!, logo);
    return `<button type="button" class="bucket-name logo" style="height:${height.toFixed(1)}px;max-width:${width.toFixed(1)}px;${fill.style}" ${label}><img src="${escape(logo.src)}" alt="" loading="lazy"></button>`;
  }
  return `<button type="button" class="bucket-name" ${label}>${escape(bucket.name)}</button>`;
}

// A brand's name in its circle where it fits whole, and its initials where not.
function circleName(name: string, inner: number) {
  return fitName(name, inner - 2, inner - 2, 15) ? brandName(name, inner - 2, inner - 2) : brandInitials(name, inner);
}

// A brand's fill, in a cell, circle or plate, by the rule in src/lib/logo.ts, as a style and the class that sets
// light text on a dark one.
const fillOf = (logos: Point['logos'], shown?: LogoFile) => {
  const fill = logoFill(logos, shown);
  return { style: `background:${fill}`, dark: isDark(fill) };
};

// The cells as circles, each drawn in its square. What a circle says is fitted to the square inside it, whose
// side is the circle's width over √2.
function renderCircles(layout: Layout, scale: number) {
  return layout.cells
    .map((cell) => {
      const diameter = cell.width * scale;
      const inner = diameter * Math.SQRT1_2;
      const style = position(cell, layout.box);
      if (cell.kind === 'tile') {
        const lines = tileLines(cell, layout);
        const name = inner >= 28 ? fittedName(cell.bucket.name, inner - 4, inner * 0.5, 16) : '';
        const badge = inner >= 44 ? `<span class="tile-badge">${cell.preview?.length ?? 0}</span>` : '';
        return (
          `<button type="button" class="tile round" style="${style}" data-zoom="${escape(cell.bucket.key)}" aria-label="${escape(lines.join(', '))}" data-tip="${escape(lines.join('\n'))}">` +
          badge +
          name +
          `</button>`
        );
      }
      if (cell.kind === 'bucket') {
        const count = layout.cells.filter((other) => other.kind === 'brand' && other.bucket === cell.bucket).length;
        const figure = layout.size.uniform ? layout.size.format(count) : `${layout.size.format(cell.value)}`;
        const tip = `${cell.bucket.name}: ${figure}\nClick to see these brands alone`;
        const name = cell.named ? bucketLabel(cell, scale) : '';
        // The whole circle zooms in for a pointer; its label is the button for the keyboard.
        return `<div class="bucket round" style="${style}" data-zoom="${escape(cell.bucket.key)}" data-tip="${escape(tip)}">${name}</div>`;
      }
      if (cell.kind === 'other') {
        const tip = `${cell.bucket.name}\nOther business: ${layout.size.format(cell.value)}`;
        return `<div class="other round" style="${style}" data-tip="${escape(tip)}">${inner >= 46 ? fittedName('Other business', inner, inner, 11) : ''}</div>`;
      }
      const point = cell.point!;
      const lines = tipLines(cell, layout);
      const logo = circleLogo(point.logos, diameter);
      const content = logo?.html || circleName(point.name, inner);
      const fill = fillOf(point.logos, logo?.logo);
      const classes = classList('brand', 'round', cell.licensed && 'licensed', fill.dark && 'on-dark');
      return `<a class="${classes}" style="${style};${fill.style}" href="${escape(point.href)}" aria-label="${escape(lines.join(', '))}" data-tip="${escape(lines.join('\n'))}">${content}</a>`;
    })
    .join('');
}

// The cells as HTML, so the build and the browser draw them the same way. `scale` is pixels per layout
// unit, which sets how many brands fit in a tile.
export function renderCells(layout: Layout, scale = 1) {
  if (layout.shape === 'circles') return renderCircles(layout, scale);
  return layout.cells
    .map((cell) => {
      if (cell.kind === 'tile') return renderTile(cell, layout, scale);
      if (cell.kind === 'bucket') {
        const tip = `${cell.bucket.name}: ${layout.size.format(cell.value)}\nClick the name to see these brands alone`;
        const name = cell.named
          ? `<button type="button" class="bucket-name" data-zoom="${escape(cell.bucket.key)}" aria-label="${escape(`Zoom into ${cell.bucket.name}`)}">${escape(cell.bucket.name)}</button>`
          : '';
        return `<div class="bucket" style="${position(cell, layout.box)}" data-tip="${escape(tip)}">${name}</div>`;
      }
      if (cell.kind === 'other') {
        const tip = `${cell.bucket.name}\nOther business: ${layout.size.format(cell.value)}`;
        return `<div class="other" style="${position(cell, layout.box)}" data-tip="${escape(tip)}">${showsName(cell) ? '<span>Other business</span>' : ''}</div>`;
      }
      const point = cell.point!;
      const lines = tipLines(cell, layout);
      // A cell's logo is drawn in at most 80% of its width and 60% of its height.
      const logo = showsLogo(cell) ? shownLogo(point.logos, cell.width * scale * 0.8, cell.height * scale * 0.6) : undefined;
      const content = logo
        ? `<img src="${escape(logo.src)}" alt="" loading="lazy">`
        : brandName(point.name, cell.width * scale - 6, cell.height * scale - 6);
      const fill = fillOf(point.logos, logo);
      const classes = classList('brand', cell.licensed && 'licensed', fill.dark && 'on-dark');
      return `<a class="${classes}" style="${position(cell, layout.box)};${fill.style}" href="${escape(point.href)}" aria-label="${escape(lines.join(', '))}" data-tip="${escape(lines.join('\n'))}">${content}</a>`;
    })
    .join('');
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

// The line under the chart: what is drawn, and what is left out and why.
export function renderNote(layout: Layout, filtered = false) {
  const { mode, size, shown, missing, hiddenLicensed, options, grouping, zoomed } = layout;
  const matching = filtered ? ' matching the filters' : '';
  const parts: string[] = [];
  if (mode === 'buckets') {
    const buckets = layout.cells.filter((cell) => cell.kind === 'tile').length;
    parts.push(`${plural(shown, 'brand')}${matching} across ${buckets} ${buckets === 1 ? 'box' : 'boxes'} by ${grouping.label.toLowerCase()}, each sized by its number of brands. Click a box to see its brands, sized by a figure of their own.`);
  } else if (size.uniform && !zoomed) {
    const buckets = layout.cells.filter((cell) => cell.kind === 'bucket').length;
    parts.push(`${plural(shown, 'brand')}${matching} across ${buckets} ${buckets === 1 ? 'circle' : 'circles'} by ${grouping.label.toLowerCase()}, one small circle per brand. Click a circle to see its brands alone.`);
  } else {
    const where = zoomed ? ` in ${zoomed.name}` : '';
    parts.push(`${plural(shown, 'brand')}${matching}${where}, sized by ${size.label.toLowerCase()}.`);
    if (missing > 0) parts.push(`${missing} more ${missing === 1 ? 'has' : 'have'} no figure for it yet${mode === 'zoomed' ? ' and ' + (missing === 1 ? 'is' : 'are') + ' listed below' : ' and ' + (missing === 1 ? 'is' : 'are') + ' left out'}.`);
  }
  if (layout.unrecorded.length > 0) {
    const count = layout.unrecorded.length;
    parts.push(`${plural(count, 'brand')} ${layout.aside} ${count === 1 ? 'is' : 'are'} listed below instead.`);
  }
  if (hiddenLicensed > 0) parts.push(`${plural(hiddenLicensed, 'brand')} made under license ${hiddenLicensed === 1 ? 'counts toward its owner' : 'count toward their owners'}, not the group that makes ${hiddenLicensed === 1 ? 'it' : 'them'}.`);
  if (size.includesLicensed && layout.cells.some((cell) => cell.licensed)) parts.push('A dashed edge marks a brand made under license, counted toward the group that makes it.');
  if (layout.partOwned > 0 && options.byStake) parts.push('A part-owned brand counts toward each owner by that owner’s stake, or in full where the stake isn’t public.');
  else if (layout.partOwned > 0) parts.push('A part-owned brand counts in full toward each of its owners.');
  if (options.otherBusiness && layout.cells.some((cell) => cell.kind === 'other')) parts.push('A hatched block is the part of a group’s own figure that its watch brands don’t account for.');
  return escape(parts.join(' '));
}

// When zoomed, the bucket's brands with no figure for the size measure, as links.
// Also, brands with nothing recorded for the grouping.
export function renderUnsized(layout: Layout) {
  const list = (points: Point[], summary: string) =>
    points.length === 0
      ? ''
      : `<details><summary>${escape(summary)}</summary><ul>${points.map((point) => `<li><a href="${escape(point.href)}">${escape(point.name)}</a></li>`).join('')}</ul></details>`;
  return (
    list(layout.unsized, `${plural(layout.unsized.length, 'brand')} with no figure for ${layout.size.label.toLowerCase()}`) +
    list(layout.unrecorded, `${plural(layout.unrecorded.length, 'brand')} ${layout.aside}`)
  );
}
