import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
import { metrics, type Metric } from './metrics';

// Everything here works on plain data, with no content collections, so the page can run the same layout
// again in the browser when a reader regroups, recolors or filters the chart.

// The layout is worked out in this box and drawn in percentages, so it scales with the page.
export const box = { width: 1000, height: 600 };
// Room at the top of each bucket for its name, given only where the bucket is big enough to spare it.
const header = 20;

// A brand as the chart sees it.
export type Point = {
  id: string;
  name: string;
  href: string;
  logo?: string;
  // The full logo's width over its height, to judge how large it would draw in a given space.
  logoAspect?: number;
  // The symbol alone, used where the full logo would draw too small to read.
  logomark?: string;
  // The bucket it sits in under each grouping, by grouping id. Several for a brand with part-owners.
  buckets: Record<string, string[]>;
  // The group making it under license. For a measure that counts licensed brands, it sits there instead of with its owner.
  licensee?: string;
  // Figures by measure id, only where known.
  values: Record<string, number>;
  captions: Record<string, string>;
};

// One box in a grouping: a group, a country, a segment.
export type Bucket = {
  key: string;
  name: string;
  href?: string;
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
};

export type ChartData = { points: Point[]; groupings: Grouping[] };

export type Options = {
  grouping: string;
  size: string;
  // A measure shown as a shade on each brand, or on each bucket as its median, or none.
  color?: string;
  // Whether a bucket's own figure beyond its brands' is drawn as a block of its own.
  otherBusiness?: boolean;
  // Brands left in by the page's filters; all of them when unset.
  visible?: Set<string>;
  // The bucket zoomed into, showing its brands alone.
  zoom?: string;
};

// What the chart shows:
// - `buckets`: one box per bucket, for a measure that is the same for every brand (a count), which says
//   nothing about the brands themselves.
// - `nested`: buckets holding their brands, for a measure that differs by brand and adds up.
// - `zoomed`: the brands of one bucket, for any measure that differs by brand, since nothing is summed across buckets.
export type Mode = 'buckets' | 'nested' | 'zoomed';

export type Cell = {
  kind: 'bucket' | 'tile' | 'brand' | 'other';
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  bucket: Bucket;
  point?: Point;
  licensed?: boolean;
  // Room was left for the bucket's name.
  named?: boolean;
  // Index into the color steps, or -1 for no figure for the color measure.
  shade?: number;
  // A tile's median for the color measure, and a few of its brands with logos to show inside it.
  median?: number;
  preview?: Point[];
};

export type Layout = {
  options: Options;
  mode: Mode;
  grouping: Grouping;
  // The bucket zoomed into, unless the grouping has only one.
  zoomed?: Bucket;
  size: Metric;
  color?: Metric;
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
  // The color measure's step boundaries, lowest first: steps.length + 1 values.
  breaks: number[];
  // Each bucket's total for the size measure, including its own figure where shown.
  totals: Record<string, number>;
};

// Sequential steps, light to dark, for a measure shown as color. Text on the last three is light.
export const steps = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const darkFrom = 4;

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
  | { kind: 'brand'; point: Point; value: number; licensed: boolean }
  | { kind: 'other'; bucket: Bucket; value: number };

// Splits the color measure's figures into equal-count steps, so a few very old or very dear brands
// do not wash every other brand out to the lightest shade.
function quantileBreaks(values: number[]) {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const inner = steps.slice(1).map((_, index) => at((index + 1) / steps.length));
  return [sorted[0], ...inner, sorted.at(-1)!];
}
const shadeOf = (value: number, breaks: number[]) => {
  for (let index = 1; index < breaks.length - 1; index++) if (value < breaks[index]) return index - 1;
  return steps.length - 1;
};
const median = (values: number[]) => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function layoutTreemap(data: ChartData, options: Options): Layout {
  const grouping = data.groupings.find((candidate) => candidate.id === options.grouping) ?? data.groupings[0];
  const zoomed = zoomedBucket(grouping, options.zoom);
  // A measure that cannot size this mode falls back to the first that can.
  const allowed = sizesFor(Boolean(zoomed));
  const size = allowed.find((metric) => metric.id === options.size) ?? allowed.find((metric) => metric.id === 'age') ?? allowed[0];
  const mode: Mode = zoomed ? 'zoomed' : size.uniform ? 'buckets' : 'nested';
  const color = options.color ? metricById(options.color) : undefined;
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
  const missing = new Map<string, Point>();
  const colorValues: number[] = [];
  const children: Datum[] = [];
  for (const bucket of buckets) {
    const brands: Datum[] = [];
    for (const { point, licensed } of members.get(bucket.key) ?? []) {
      const value = point.values[size.id];
      if (value === undefined || value <= 0) {
        missing.set(point.id, point);
        continue;
      }
      brands.push({ kind: 'brand', point, value, licensed });
      if (drawn.has(point.id)) continue;
      drawn.add(point.id);
      if (mode !== 'buckets' && color && point.values[color.id] !== undefined) colorValues.push(point.values[color.id]);
    }
    if (brands.length === 0) continue;
    if (mode === 'buckets') {
      const points = brands.map((brand) => (brand as Extract<Datum, { kind: 'brand' }>).point);
      const middle = color ? median(points.flatMap((point) => (point.values[color.id] === undefined ? [] : [point.values[color.id]]))) : undefined;
      if (middle !== undefined) colorValues.push(middle);
      children.push({ kind: 'tile', bucket, value: brands.length, points });
      continue;
    }
    const brandTotal = brands.reduce((total, child) => total + (child.kind === 'brand' ? child.value : 0), 0);
    const own = options.otherBusiness && size.additive ? bucket.values?.[size.id] : undefined;
    if (own !== undefined && own > brandTotal) brands.push({ kind: 'other', bucket, value: own - brandTotal });
    children.push({ kind: 'bucket', bucket, children: brands });
  }
  const breaks = quantileBreaks(colorValues);

  const root = hierarchy<Datum>({ kind: 'root', children }, (d) => ('children' in d ? d.children : undefined))
    .sum((d) => ('value' in d ? d.value : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const roomy = (node: HierarchyRectangularNode<Datum>) => mode === 'nested' && node.y1 - node.y0 > 48 && node.x1 - node.x0 > 56;
  const laidOut = treemap<Datum>()
    .tile(treemapSquarify)
    .size([box.width, box.height])
    .paddingOuter(mode === 'zoomed' ? 0 : 3)
    .paddingInner(2)
    .paddingTop((node) => (node.depth === 1 && roomy(node) ? header : mode === 'zoomed' ? 0 : 3))(root);

  const totals: Record<string, number> = {};
  const cells = laidOut.descendants().flatMap((node): Cell[] => {
    const d = node.data;
    if (d.kind === 'root') return [];
    const shape = { x: node.x0, y: node.y0, width: node.x1 - node.x0, height: node.y1 - node.y0, value: node.value ?? 0 };
    if (d.kind === 'tile') {
      totals[d.bucket.key] = d.value;
      const middle = color ? median(d.points.flatMap((point) => (point.values[color.id] === undefined ? [] : [point.values[color.id]]))) : undefined;
      // Brands with logos lead the preview, then the rest; within each, the highest on the color measure, or else the alphabet.
      const rank = (point: Point) => (color ? (point.values[color.id] ?? -1) : 0);
      const preview = [...d.points].sort(
        (a, b) => Number(Boolean(b.logo || b.logomark)) - Number(Boolean(a.logo || a.logomark)) || rank(b) - rank(a) || a.name.localeCompare(b.name),
      );
      return [{ kind: 'tile', ...shape, bucket: d.bucket, median: middle, preview, shade: color ? (middle === undefined ? -1 : shadeOf(middle, breaks)) : undefined }];
    }
    if (d.kind === 'bucket') {
      totals[d.bucket.key] = node.value ?? 0;
      // A zoomed bucket is the whole chart, so it needs no box of its own.
      return mode === 'zoomed' ? [] : [{ kind: 'bucket', ...shape, bucket: d.bucket, named: roomy(node) }];
    }
    const bucket = (node.parent!.data as Extract<Datum, { kind: 'bucket' }>).bucket;
    if (d.kind === 'other') return [{ kind: 'other', ...shape, bucket }];
    const shadeValue = color ? d.point.values[color.id] : undefined;
    return [
      {
        kind: 'brand',
        ...shape,
        bucket,
        point: d.point,
        licensed: d.licensed,
        shade: color ? (shadeValue === undefined ? -1 : shadeOf(shadeValue, breaks)) : undefined,
      },
    ];
  });

  return {
    options,
    mode,
    grouping,
    zoomed: grouping.buckets.length > 1 ? zoomed : undefined,
    size,
    color,
    cells,
    shown: drawn.size,
    missing: missing.size,
    unsized: mode === 'zoomed' ? [...missing.values()].sort((a, b) => a.name.localeCompare(b.name)) : [],
    unrecorded: unrecorded.sort((a, b) => a.name.localeCompare(b.name)),
    aside: setAside?.aside,
    hiddenLicensed,
    breaks,
    totals,
  };
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const pct = (value: number, of: number) => `${((value / of) * 100).toFixed(3)}%`;
const position = ({ x, y, width, height }: Cell) =>
  `left:${pct(x, box.width)};top:${pct(y, box.height)};width:${pct(width, box.width)};height:${pct(height, box.height)}`;

// What fits in a cell, judged in layout units (about a pixel each at full width).
const showsName = ({ width, height }: Cell) => width >= 46 && height >= 16;

// The lines of a brand's tooltip: name, then where it sits, then its figures.
const tipLines = (cell: Cell, layout: Layout) => {
  const point = cell.point!;
  const lines = [point.name + (cell.licensed ? ' (made under license)' : '')];
  if (cell.bucket.name) lines.push(cell.bucket.name);
  lines.push(`${layout.size.label}: ${layout.size.format(cell.value)}`);
  if (layout.color) {
    const value = point.values[layout.color.id];
    lines.push(`${layout.color.label}: ${value === undefined ? 'no figure yet' : layout.color.format(value)}`);
  }
  const caption = point.captions[layout.color?.id ?? layout.size.id] ?? point.captions[layout.size.id];
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

// Which image to show for a brand in a space `width` by `height` pixels: the full logo where it draws at least
// 14px tall, enough to read a wordmark; else the logomark, where the brand has one and the space is at least
// 14px each way. None means the space shows the brand's name instead, which reads better than a tiny logo.
const readable = 14;
function logoFor(point: Point, width: number, height: number) {
  if (point.logo && Math.min(height, width / (point.logoAspect ?? 3)) >= readable) return point.logo;
  if (point.logomark && Math.min(width, height) >= readable) return point.logomark;
  return undefined;
}

// A bucket drawn whole: its name, its count, a few of its brands' logos, and its median as a shade.
function renderTile(cell: Cell, layout: Layout, scale: number) {
  const { bucket, value, median, preview = [] } = cell;
  const lines = [bucket.name, layout.size.format(value)];
  if (layout.color) lines.push(`Median ${layout.color.label.toLowerCase()}: ${median === undefined ? 'no figures yet' : layout.color.format(median)}`);
  lines.push('Click to see its brands');
  const shaded = cell.shade !== undefined && cell.shade >= 0;
  // A tile narrower or shorter than its padding would be widened by it, past the edge of the chart.
  const tight = cell.width < 30 || cell.height < 30;
  const classes = ['tile', cell.shade === -1 && 'unshaded', shaded && cell.shade! >= darkFrom && 'on-dark', tight && 'tight'].filter(Boolean).join(' ');
  const style = position(cell) + (shaded ? `;--shade:${steps[cell.shade!]}` : '');
  // Its brands sit in a grid of plates below the name, a logo where there is one and the name where not.
  // The plates grow to fill the tile when it has few brands, and shrink no smaller than 50 by 26px (room for a
  // name on two lines) when it has many, where the last plate says how many more there are. Plates are sized
  // in pixels, so this is worked out at the size the chart is drawn: the tile's padding and border take 18px
  // across, and with its name and count and their spacing about 62px down.
  const grid = plateGrid(cell.width * scale - 18, cell.height * scale - 62, preview.length);
  const room = grid.columns * grid.rows;
  const shown = preview.length > room ? preview.slice(0, Math.max(0, room - 1)) : preview;
  const more = preview.length - shown.length;
  const plates = shown.map((point) => {
    const image = logoFor(point, grid.width - 8, grid.height - 4);
    return image
      ? `<span class="plate"><img src="${escape(image)}" alt="" loading="lazy"></span>`
      : `<span class="plate named">${fittedName(point.name, grid.width - 8, grid.height - 4, Math.min(18, grid.height * 0.45))}</span>`;
  });
  if (room > 0 && more > 0) plates.push(`<span class="plate more">+${more} more</span>`);
  const gridStyle = `grid-template-columns:repeat(${grid.columns},${grid.width.toFixed(1)}px);grid-auto-rows:${grid.height.toFixed(1)}px;--plate-font:${Math.min(16, Math.max(10, grid.height * 0.38)).toFixed(1)}px`;
  const roomForName = cell.width >= 40 && cell.height >= 22;
  const roomForCount = cell.width >= 40 && cell.height >= 38;
  return (
    `<button type="button" class="${classes}" style="${style}" data-zoom="${escape(bucket.key)}" aria-label="${escape(lines.join(', '))}" data-tip="${escape(lines.join('\n'))}">` +
    (roomForName ? `<span class="tile-name">${escape(bucket.name)}</span>` : '') +
    (roomForCount ? `<span class="tile-count">${escape(layout.size.format(value))}</span>` : '') +
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

// The cells as HTML, so the build and the browser draw them the same way. `scale` is pixels per layout
// unit, which sets how many brands fit in a tile.
export function renderCells(layout: Layout, scale = 1) {
  return layout.cells
    .map((cell) => {
      if (cell.kind === 'tile') return renderTile(cell, layout, scale);
      if (cell.kind === 'bucket') {
        const tip = `${cell.bucket.name}: ${layout.size.format(cell.value)}\nClick the name to see these brands alone`;
        const name = cell.named
          ? `<button type="button" class="bucket-name" data-zoom="${escape(cell.bucket.key)}" aria-label="${escape(`Zoom into ${cell.bucket.name}`)}">${escape(cell.bucket.name)}</button>`
          : '';
        return `<div class="bucket" style="${position(cell)}" data-tip="${escape(tip)}">${name}</div>`;
      }
      if (cell.kind === 'other') {
        const tip = `${cell.bucket.name}\nOther business: ${layout.size.format(cell.value)}`;
        return `<div class="other" style="${position(cell)}" data-tip="${escape(tip)}">${showsName(cell) ? '<span>Other business</span>' : ''}</div>`;
      }
      const point = cell.point!;
      const lines = tipLines(cell, layout);
      const shade = cell.shade !== undefined && cell.shade >= 0 ? `;--shade:${steps[cell.shade]}` : '';
      const image = cell.width >= 16 && cell.height >= 16 ? logoFor(point, cell.width * scale * 0.8, cell.height * scale * 0.6) : undefined;
      const content = image
          ? `<img src="${escape(image)}" alt="" loading="lazy">`
          : brandName(point.name, cell.width * scale - 6, cell.height * scale - 6);
      // A shaded cell is filled with its shade. A logo gets a white halo so a dark mark stays legible; a name
      // turns white on the darker steps instead.
      const classes = ['brand', cell.licensed && 'licensed', cell.shade !== undefined && 'shaded', cell.shade === -1 && 'unshaded', (cell.shade ?? -1) >= darkFrom && 'on-dark']
        .filter(Boolean)
        .join(' ');
      return `<a class="${classes}" style="${position(cell)}${shade}" href="${escape(point.href)}" aria-label="${escape(lines.join(', '))}" data-tip="${escape(lines.join('\n'))}">${content}</a>`;
    })
    .join('');
}

// The key for a measure shown as color: one swatch per step, labeled at its ends, and one for no figure.
export function renderLegend(layout: Layout) {
  const { color, breaks } = layout;
  if (!color) return '';
  if (breaks.length === 0) return `<p class="legend-empty">No brand here has a figure for ${escape(color.label.toLowerCase())} yet.</p>`;
  const swatches = steps
    .map((step, index) => {
      const range = `${color.format(breaks[index])} to ${color.format(breaks[index + 1])}`;
      return `<span class="swatch" style="background:${step}" title="${escape(range)}"></span>`;
    })
    .join('');
  return (
    `<span class="legend-label">${escape(layout.mode === 'buckets' ? `Median ${color.label.toLowerCase()}` : color.label)}</span>` +
    `<span class="legend-end">${escape(color.format(breaks[0]))}</span>` +
    `<span class="swatches" role="img" aria-label="${escape(`Lighter to darker: ${color.format(breaks[0])} to ${color.format(breaks.at(-1)!)}`)}">${swatches}</span>` +
    `<span class="legend-end">${escape(color.format(breaks.at(-1)!))}</span>` +
    `<span class="swatch none" aria-hidden="true"></span><span class="legend-end">No figure</span>`
  );
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
