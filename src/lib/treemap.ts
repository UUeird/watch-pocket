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
  // A measure shown as a shade on each brand, or none.
  color?: string;
  // Whether a bucket's own figure beyond its brands' is drawn as a block of its own.
  otherBusiness?: boolean;
  // Brands left in by the page's filters; all of them when unset.
  visible?: Set<string>;
};

export type Cell = {
  kind: 'bucket' | 'brand' | 'other';
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
  // Index into the color steps, or -1 for a brand with no figure for the color measure.
  shade?: number;
};

export type Layout = {
  options: Options;
  size: Metric;
  color?: Metric;
  cells: Cell[];
  // Brands drawn, and brands in these buckets with no figure for the size measure.
  shown: number;
  missing: number;
  // Brands made under license that a measure of what a group owns does not count toward the maker.
  hiddenLicensed: number;
  // The color measure's step boundaries, lowest first: steps.length + 1 values.
  breaks: number[];
  // Each bucket's total for the size measure, including its own figure where shown.
  totals: Record<string, number>;
};

// Sequential steps, light to dark, for a measure shown as color.
export const steps = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

export const metricById = (id: string) => metrics.find((metric) => metric.id === id) ?? metrics[0];

type Datum =
  | { kind: 'root'; children: Datum[] }
  | { kind: 'bucket'; bucket: Bucket; children: Datum[] }
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

export function layoutTreemap(data: ChartData, options: Options): Layout {
  const grouping = data.groupings.find((candidate) => candidate.id === options.grouping) ?? data.groupings[0];
  const size = metricById(options.size);
  const color = options.color ? metricById(options.color) : undefined;
  const moveLicensed = Boolean(grouping.licensing && size.includesLicensed);
  const bucketKeys = new Set(grouping.buckets.map((bucket) => bucket.key));

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
  const missing = new Set<string>();
  const colorValues: number[] = [];
  const children: Datum[] = [];
  for (const bucket of grouping.buckets) {
    const brands: Datum[] = [];
    for (const { point, licensed } of members.get(bucket.key) ?? []) {
      const value = point.values[size.id];
      if (value === undefined || value <= 0) {
        missing.add(point.id);
        continue;
      }
      brands.push({ kind: 'brand', point, value, licensed });
      if (drawn.has(point.id)) continue;
      drawn.add(point.id);
      if (color && point.values[color.id] !== undefined) colorValues.push(point.values[color.id]);
    }
    const brandTotal = brands.reduce((total, child) => total + (child.kind === 'brand' ? child.value : 0), 0);
    const own = options.otherBusiness ? bucket.values?.[size.id] : undefined;
    if (own !== undefined && own > brandTotal) brands.push({ kind: 'other', bucket, value: own - brandTotal });
    if (brands.length > 0) children.push({ kind: 'bucket', bucket, children: brands });
  }
  const breaks = quantileBreaks(colorValues);

  const root = hierarchy<Datum>({ kind: 'root', children }, (d) => ('children' in d ? d.children : undefined))
    .sum((d) => ('value' in d ? d.value : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  // A lone bucket, as when nothing is grouped, needs no name.
  const single = children.length === 1 && grouping.buckets.length === 1;
  const roomy = (node: HierarchyRectangularNode<Datum>) => !single && node.y1 - node.y0 > 48 && node.x1 - node.x0 > 56;
  const laidOut = treemap<Datum>()
    .tile(treemapSquarify)
    .size([box.width, box.height])
    .paddingOuter(3)
    .paddingInner(2)
    .paddingTop((node) => (node.depth === 1 && roomy(node) ? header : 3))(root);

  const totals: Record<string, number> = {};
  const cells = laidOut.descendants().flatMap((node): Cell[] => {
    const d = node.data;
    if (d.kind === 'root') return [];
    const shape = { x: node.x0, y: node.y0, width: node.x1 - node.x0, height: node.y1 - node.y0, value: node.value ?? 0 };
    if (d.kind === 'bucket') {
      totals[d.bucket.key] = node.value ?? 0;
      return [{ kind: 'bucket', ...shape, bucket: d.bucket, named: roomy(node) }];
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

  return { options, size, color, cells, shown: drawn.size, missing: missing.size, hiddenLicensed, breaks, totals };
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

// The cells as HTML, so the build and the browser draw them the same way.
export function renderCells(layout: Layout) {
  return layout.cells
    .map((cell) => {
      if (cell.kind === 'bucket') {
        const tip = `${cell.bucket.name}: ${layout.size.format(cell.value)}`;
        const name = !cell.named
          ? ''
          : cell.bucket.href
            ? `<a class="bucket-name" href="${escape(cell.bucket.href)}">${escape(cell.bucket.name)}</a>`
            : `<span class="bucket-name">${escape(cell.bucket.name)}</span>`;
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
    `<span class="legend-label">${escape(color.label)}</span>` +
    `<span class="legend-end">${escape(color.format(breaks[0]))}</span>` +
    `<span class="swatches" role="img" aria-label="${escape(`Lighter to darker: ${color.format(breaks[0])} to ${color.format(breaks.at(-1)!)}`)}">${swatches}</span>` +
    `<span class="legend-end">${escape(color.format(breaks.at(-1)!))}</span>` +
    `<span class="swatch none" aria-hidden="true"></span><span class="legend-end">No figure</span>`
  );
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

// The line under the chart: what is drawn, and what is left out and why.
export function renderNote(layout: Layout, total?: number) {
  const { size, shown, missing, hiddenLicensed, options } = layout;
  const parts = [
    total !== undefined
      ? `${plural(shown, 'brand')} matching the filters, sized by ${size.label.toLowerCase()}.`
      : `${plural(shown, 'brand')} sized by ${size.label.toLowerCase()}.`,
  ];
  if (missing > 0) parts.push(`${missing} more ${missing === 1 ? 'has' : 'have'} no figure for it yet and ${missing === 1 ? 'is' : 'are'} left out.`);
  if (hiddenLicensed > 0) parts.push(`${plural(hiddenLicensed, 'brand')} made under license ${hiddenLicensed === 1 ? 'counts toward its owner' : 'count toward their owners'}, not the group that makes ${hiddenLicensed === 1 ? 'it' : 'them'}.`);
  if (size.includesLicensed && layout.cells.some((cell) => cell.licensed)) parts.push('A dashed edge marks a brand made under license, counted toward the group that makes it.');
  if (options.otherBusiness && layout.cells.some((cell) => cell.kind === 'other')) parts.push('A hatched block is the part of a group’s own figure that its watch brands don’t account for.');
  return escape(parts.join(' '));
}
