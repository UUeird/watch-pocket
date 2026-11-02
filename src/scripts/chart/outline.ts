import { brandOfBox, escape, flagOf, isContext, labelOf, logoHtml, pageOf, pathOf, type Box, type Context } from './common';
import { describe, LEVEL_NAMES, measureText, NOT_RECORDED, segmentName, usd } from './tree';

// The Outline view: the same tree as an expandable list with counts. The default on phones, and readable by a
// screen reader as a tree.

const ROW_BUDGET = 700;

export function renderOutline(host: HTMLElement, ctx: Context) {
  const { state, focus: f, built } = ctx;
  // Search results open their path.
  for (const hit of built.search?.hits ?? []) built.top.each((box) => box.data.eid === hit.eid && box.ancestors().forEach((a) => ctx.expanded.add(a.data.id)));
  ctx.expanded.add(f.data.id);

  const rows: { box: Box; depth: number; merged: boolean }[] = [];
  let budget = ROW_BUDGET;
  const walk = (box: Box, depth: number) => {
    if (budget-- <= 0) return;
    let merged = false;
    // An independent brand's owner and brand are one row.
    if (box.data.self && box.children?.length === 1) {
      box = box.children[0];
      merged = true;
    }
    rows.push({ box, depth, merged });
    if (box.children && ctx.expanded.has(box.data.id)) for (const kid of box.children) walk(kid, depth + 1);
  };
  for (const kid of f.children ?? []) walk(kid, 0);

  const prefixed = state.from >= 2 && !f.ancestors().some((a) => a.data.level === 'brand');
  const query = state.q.trim().toLowerCase();
  const highlight = (text: string) => {
    const at = query ? text.toLowerCase().indexOf(query) : -1;
    return at < 0 ? escape(text) : `${escape(text.slice(0, at))}<mark>${escape(text.slice(at, at + query.length))}</mark>${escape(text.slice(at + query.length))}`;
  };
  const tree = document.createElement('div');
  tree.className = 'outline';
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', labelOf(ctx, f));
  tree.innerHTML =
    rows
      .map(({ box, depth, merged }, i) => {
        const open = ctx.expanded.has(box.data.id) && !!box.children;
        // A row at the deepest level shown can still open, onto the next level down.
        const opens = !!box.children || (box.data.kids.size > 0 && box.data.level !== 'ref');
        const brand = box.data.level === 'brand' ? box.data.brand : undefined;
        const before = prefixed ? brandOfBox(ctx, box)?.name : undefined;
        const meta = [measureText(box.data, state.sort), describe(box.data)].filter(Boolean).join(' · ');
        return `<div class="row${isContext(box) ? ' ghost' : ''}${box.data.eid === state.selected ? ' sel' : ''}" data-i="${i}" role="treeitem" aria-level="${depth + 1}" ${
          opens ? `aria-expanded="${open}"` : ''
        } tabindex="${i === 0 ? 0 : -1}" style="padding-left:${12 + depth * 18}px">
          <span class="tw" aria-hidden="true">${opens ? (open ? '▾' : '▸') : '·'}</span>
          <span class="nm">${logoHtml(brand, 30, 14, 'lg')}${before ? `<span class="pre">${escape(before)} · </span>` : ''}${highlight(labelOf(ctx, box))} <span class="tag">${
            merged ? 'Independent brand' : LEVEL_NAMES[box.data.level]
          }</span></span>
          <span class="meta">${escape(meta)}</span></div>`;
      })
      .join('') + (budget <= 0 ? `<p class="empty">Showing the first ${ROW_BUDGET} rows. Narrow the filters or zoom in to see more.</p>` : '');
  host.replaceChildren(tree);

  const items = [...tree.querySelectorAll<HTMLElement>('.row')];
  tree.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.row');
    if (row) ctx.toggleRow(rows[+row.dataset.i!].box);
  });
  tree.addEventListener('keydown', (event) => {
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const { box } = rows[at];
    const go = (to: number) => {
      const next = items[Math.max(0, Math.min(items.length - 1, to))];
      items[at].tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Enter' || event.key === ' ') ctx.toggleRow(box);
    else if (event.key === 'ArrowRight' && (box.children || box.data.kids.size > 0) && !(box.children && ctx.expanded.has(box.data.id))) ctx.toggleRow(box);
    else if (event.key === 'ArrowLeft' && box.children && ctx.expanded.has(box.data.id)) ctx.toggleRow(box);
    else return;
    event.preventDefault();
  });
}

// The strip above the chart: what's selected, where it sits, its facts, and a link to its page.
export function renderInfo(host: HTMLElement, ctx: Context, box: Box) {
  const node = box.data;
  const c = node.counts;
  const { index, state } = ctx;
  const facts: [string, string | number][] = [];
  const country = (name?: string) => (name ? `${flagOf(index, name)} ${name}`.trim() : NOT_RECORDED);
  if (node.level === 'brand') {
    const brand = node.brand!;
    facts.push(['Owner', index.ownerLabel(brand)], ['Origin', country(brand.origin)]);
    if (brand.headquarters) facts.push(['Headquarters', brand.headquarters]);
    if (brand.madeIn.length) facts.push(['Made in', brand.madeIn.join(', ')]);
    facts.push(['Segment', segmentName(brand.segment)], ['Founded', brand.founded ?? NOT_RECORDED]);
    if (brand.revenue) facts.push(['Revenue', usd(brand.revenue)]);
    if (node.share !== undefined && node.share < 1) facts.push(['Stake here', `${Math.round(node.share * 100)}%`]);
    if (index.linesOf.has(brand.id)) facts.push(['Catalogued', `${c.line} lines · ${c.model} models · ${c.ref} refs`]);
    else if (ctx.showGaps) facts.push(['Catalogued', 'No lines yet']);
  } else if (node.level === 'owner') {
    if (node.group) {
      const group = node.group;
      facts.push(['Home', country(group.country)]);
      if (group.parent) facts.push(['Part of', index.groupsById.get(group.parent)?.name ?? '']);
      if (group.revenue) facts.push(['Revenue', usd(group.revenue)]);
    }
    if (node.self) facts.push(['Owner', 'Itself (independent)'], ['Origin', country(node.self.origin)]);
    facts.push(['Brands shown', node.total && c.brand < node.total ? `${c.brand} of ${node.total}` : c.brand]);
  } else if (node.level === 'line') facts.push(['Models', c.model], ['References', c.ref]);
  else if (node.level === 'model') {
    if (node.model!.style) facts.push(['Style', node.model!.style]);
    facts.push(['References', c.ref]);
  } else if (node.level === 'ref') {
    const ref = node.ref!;
    if (ref.since) facts.push(['Released', ref.since + (ref.until ? `, ended ${ref.until}` : '')]);
    if (ref.caseSize) facts.push(['Case', `${ref.caseSize} mm`]);
    if (ref.metals.length) facts.push(['Metals', ref.metals.join(', ')]);
    if (ref.price) facts.push(['List price', usd(ref.price)]);
  } else facts.push(['Brands', c.brand], ['Lines', c.line], ['Models', c.model], ['References', c.ref]);

  const path = pathOf(box).slice(1, -1).map((item) => labelOf(ctx, item)).join(' › ');
  const page = pageOf(box);
  const zoomIn = (box.children || node.kids.size > 0) && box !== ctx.focus;
  host.innerHTML = `<div class="who"><div class="eyebrow">${LEVEL_NAMES[node.level]}${isContext(box) ? ' · context only' : ''}</div>
    <h2>${escape(labelOf(ctx, box))}</h2>${path ? `<div class="path">${escape(path)}</div>` : ''}</div>
    <dl>${facts.map(([term, value]) => `<div><dt>${term}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
    <div class="act">${zoomIn ? '<button type="button" data-act="in">Zoom in</button>' : ''}${
      box === ctx.focus && box.parent ? '<button type="button" data-act="out">Zoom out</button>' : ''
    }${page ? `<a href="${escape(page)}">Open page</a>` : ''}</div>
    ${isContext(box) ? '<p class="path note">Filtered out, but shown because a brand it owns is in view.</p>' : ''}`;
  host.onclick = (event) => {
    const act = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'in') ctx.zoomTo(box);
    if (act === 'out' && box.parent) ctx.zoomTo(box.parent);
  };
}
