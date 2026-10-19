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
  const buckets = zoomed ? [zoomed] : grouping.buckets;
  const bucketKeys = new Set(buckets.map((bucket) => bucket.key));

  const members = new Map<string, { point: Point; licensed: boolean }[]>();
  let hiddenLicensed = 0;
  for (const point of data.points) {
    if (options.visible && !options.visible.has(point.id)) continue;
    const licensed = moveLicensed && point.licensee !== undefined;
    const keys = licensed ? [point.licensee!] : (point.buckets[grouping.id] ?? []);
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
      // The brands most marked on the color measure lead the preview, or else the alphabet does.
      const preview = d.points
        .filter((point) => point.logo)
        .sort((a, b) => (color ? (b.values[color.id] ?? -1) - (a.values[color.id] ?? -1) : a.name.localeCompare(b.name)))
        .slice(0, 12);
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
const showsLogo = ({ width, height }: Cell) => width >= 70 && height >= 40;
const showsName = ({ width, height }: Cell) => width >= 46 && height >= 16;
// A brand too small for a shade bar along its foot is filled with the shade instead.
const tiny = ({ width, height }: Cell) => width < 18 || height < 18;

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

// A bucket drawn whole: its name, its count, a few of its brands' logos, and its median as a shade.
function renderTile(cell: Cell, layout: Layout) {
  const { bucket, value, median, preview = [] } = cell;
  const lines = [bucket.name, layout.size.format(value)];
  if (layout.color) lines.push(`Median ${layout.color.label.toLowerCase()}: ${median === undefined ? 'no figures yet' : layout.color.format(median)}`);
  lines.push('Click to see its brands');
  const shaded = cell.shade !== undefined && cell.shade >= 0;
  const classes = ['tile', cell.shade === -1 && 'unshaded', shaded && cell.shade! >= darkFrom && 'on-dark'].filter(Boolean).join(' ');
  const style = position(cell) + (shaded ? `;--shade:${steps[cell.shade!]}` : '');
  // Logos sit in a grid of small plates below the name, as many as fit.
  const columns = Math.floor((cell.width - 10) / 54);
  const rows = Math.floor((cell.height - 46) / 28);
  const logos = columns > 0 && rows > 0 ? preview.slice(0, columns * rows) : [];
  const roomForName = cell.width >= 40 && cell.height >= 22;
  const roomForCount = cell.width >= 40 && cell.height >= 38;
  return (
    `<button type="button" class="${classes}" style="${style}" data-zoom="${escape(bucket.key)}" aria-label="${escape(lines.join(', '))}" data-tip="${escape(lines.join('\n'))}">` +
    (roomForName ? `<span class="tile-name">${escape(bucket.name)}</span>` : '') +
    (roomForCount ? `<span class="tile-count">${escape(layout.size.format(value))}</span>` : '') +
    (logos.length > 0
      ? `<span class="tile-logos" style="grid-template-columns:repeat(${columns},1fr)">${logos.map((point) => `<span class="plate"><img src="${escape(point.logo!)}" alt="" loading="lazy"></span>`).join('')}</span>`
      : '') +
    `</button>`
  );
}

// The cells as HTML, so the build and the browser draw them the same way.
export function renderCells(layout: Layout) {
  return layout.cells
    .map((cell) => {
      if (cell.kind === 'tile') return renderTile(cell, layout);
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
      const classes = ['brand', cell.licensed && 'licensed', cell.shade !== undefined && (tiny(cell) ? 'filled' : 'barred'), cell.shade === -1 && 'unshaded']
        .filter(Boolean)
        .join(' ');
      const shade = cell.shade !== undefined && cell.shade >= 0 ? `;--shade:${steps[cell.shade]}` : '';
      const content =
        showsLogo(cell) && point.logo
          ? `<img src="${escape(point.logo)}" alt="" loading="lazy">`
          : showsName(cell)
            ? `<span>${escape(point.name)}</span>`
            : // A narrow, tall cell runs its name up the side; a small one uses smaller type.
              cell.height >= 50 && cell.width >= 14 && cell.height >= cell.width * 1.6
              ? `<span class="vertical">${escape(point.name)}</span>`
              : cell.width >= 30 && cell.height >= 14
                ? `<span class="small">${escape(point.name)}</span>`
                : '';
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
  if (hiddenLicensed > 0) parts.push(`${plural(hiddenLicensed, 'brand')} made under license ${hiddenLicensed === 1 ? 'counts toward its owner' : 'count toward their owners'}, not the group that makes ${hiddenLicensed === 1 ? 'it' : 'them'}.`);
  if (size.includesLicensed && layout.cells.some((cell) => cell.licensed)) parts.push('A dashed edge marks a brand made under license, counted toward the group that makes it.');
  if (options.otherBusiness && layout.cells.some((cell) => cell.kind === 'other')) parts.push('A hatched block is the part of a group’s own figure that its watch brands don’t account for.');
  return escape(parts.join(' '));
}

// When zoomed, the bucket's brands with no figure for the size measure, as links.
export function renderUnsized(layout: Layout) {
  if (layout.unsized.length === 0) return '';
  const links = layout.unsized.map((point) => `<li><a href="${escape(point.href)}">${escape(point.name)}</a></li>`).join('');
  return `<details><summary>${plural(layout.unsized.length, 'brand')} with no figure for ${escape(layout.size.label.toLowerCase())}</summary><ul>${links}</ul></details>`;
}
