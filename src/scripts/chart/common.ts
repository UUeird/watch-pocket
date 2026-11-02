import type { HierarchyNode } from 'd3-hierarchy';
import { logoFill, logoReads, pickLogo } from '../../lib/logo';
import type { ChartBrand } from '../../lib/chart-payload';
import type { Built, Index, Node, State } from './tree';

export type Box = HierarchyNode<Node>;

// What the views need from the page: the data, the state, the built tree, and what to do when someone acts.
export type Context = {
  index: Index;
  state: State;
  built: Built;
  // The deepest level drawn, which can stop short of the one asked for when a level is empty.
  to: number;
  focus: Box;
  // How many children a box lists before a "+N more" row, where someone has asked to see all.
  limits: Map<string, number>;
  // Boxes whose folded run of independent brands is open.
  openIndependents: Set<string>;
  // Outline rows that are open.
  expanded: Set<string>;
  // Marks for brands and lines with nothing catalogued below them. Shown to editors only, on the dev server.
  showGaps: boolean;
  select: (box: Box, zoom: boolean) => void;
  zoomTo: (box: Box) => void;
  showAll: (box: Box) => void;
  toggleIndependents: (box: Box) => void;
  toggleRow: (box: Box) => void;
};

export const escape = (text: unknown) =>
  String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export const flagOf = (index: Index, country: string) => index.payload.flags[country] ?? '';

export const labelOf = (ctx: Context, box: Box) =>
  box.data.level === 'root'
    ? 'All'
    : box.data.level === 'lens' && ctx.state.groupBy === 'country'
      ? `${flagOf(ctx.index, box.data.name)} ${box.data.name}`.trim()
      : box.data.name;

export const isContext = (box: Box) => box.data.level === 'brand' && !!box.data.context;
export const isMatch = (ctx: Context, box: Box) => !!ctx.built.search?.marked.has(box.data.eid);

// An independent brand's owner box is the brand itself, so a path doesn't name it twice.
export const pathOf = (box: Box) => {
  const chain = box.ancestors().reverse();
  return chain.filter((item, i) => !(item.data.self && chain[i + 1]?.data.eid === `b:${item.data.self.id}`));
};

// The brand a line or model belongs to, named before it where the Brand level isn't in view.
export const brandOfBox = (ctx: Context, box: Box): ChartBrand | undefined =>
  box.data.level === 'line' ? ctx.index.brandsById.get(box.data.line!.brand) : box.data.level === 'model' ? ctx.index.brandOfModel(box.data.model!) : undefined;

// A brand's logo for a space `width` by `height`, on its plate, by the shared rule in src/lib/logo.ts; empty where
// the brand has none or it wouldn't read at that size.
export function logoHtml(brand: ChartBrand | undefined, width: number, height: number, className: string) {
  const set = brand?.logo;
  if (!set) return '';
  const shown = pickLogo(set, width, height);
  if (!shown || !logoReads(set, shown, width, height)) return '';
  return `<span class="${className}" style="background:${logoFill(set, shown)}"><img alt="" src="${escape(shown.src)}"></span>`;
}

// The page an item has on the site, if any.
export function pageOf(box: Box) {
  const node = box.data;
  return node.group?.href ?? node.self?.href ?? node.brand?.href ?? node.line?.href ?? (node.level === 'model' ? node.model?.href : undefined) ?? node.ref?.href;
}
