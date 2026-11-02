import { brandOfBox, escape, isContext, isMatch, labelOf, logoHtml, type Box, type Context } from './common';
import { describe, LEVEL_NAMES, LEVELS, levelIndex, measureText, type Kind } from './tree';

// The Columns view: one column per level, so a column only ever holds one kind of thing. Every box is a whole number
// of rows, so every label fits. A sub-group or a brand owned by a brand nests inside its parent in the same column.
// References sit inside their model as a grid of chips.

const ROW = 26;
const BAR = 30;
const HEAD = 24;
const LIMIT = 12;
const GAP = 4;
const INDENT = 10;
// Independent brands fold behind one row when there are more than this many in view.
const FOLD_AT = 24;
const MIN_COLUMN = 150;
const ORDER: Record<Kind, number> = { root: -1, lens: 0, owner: 1, brand: 2, line: 3, model: 4, ref: 5 };

type Laid = { box: Box; row: number; rows: number; indent: number; merged: boolean; deeper: number; refs: boolean };
type Chip = { box: Box; x: number; y: number; w: number };
type Extra = { parent: Box; n: number; row: number; level: Kind };
type Toggle = { parent: Box; n: number; row: number; open: boolean };

export function renderColumns(host: HTMLElement, ctx: Context) {
  const { state, focus: f } = ctx;
  const width = host.clientWidth;
  const refsInside = ctx.to === 4 && state.from < 4;
  const hostsRefs = (box: Box) => refsInside && box.children?.[0]?.data.level === 'ref';
  const range: Kind[] = [...(state.groupBy !== 'none' ? (['lens'] as Kind[]) : []), ...LEVELS.slice(state.from, ctx.to + 1)].filter(
    (level) => !(refsInside && level === 'ref'),
  );
  const sameKids = (f.children ?? []).some((kid) => kid.data.level === f.data.level);
  let columns = range.filter((level) => ORDER[level] > ORDER[f.data.level] || (sameKids && level === f.data.level));
  if (!columns.length) columns = [f.children?.[0]?.data.level ?? 'ref'];
  columns = columns.slice(0, Math.max(1, Math.floor((width - BAR) / MIN_COLUMN)));
  const col = (level: Kind) => {
    const i = columns.indexOf(level);
    return i < 0 ? null : i;
  };
  const last = columns.length - 1;
  const wide = refsInside && columns[last] === 'model';
  const unit = (width - BAR) / (columns.length + (wide ? 1 : 0));
  const colX = (i: number) => BAR + i * unit;
  const canMerge = col('owner') !== null && col('brand') !== null;
  const prefix = col('brand') === null && !f.ancestors().some((a) => a.data.level === 'brand');

  const laid: Laid[] = [];
  const chips: Chip[] = [];
  const extras: Extra[] = [];
  const toggles: Toggle[] = [];
  const left = (item: Laid) => (item.merged ? colX(col('owner')!) : colX(col(item.box.data.level)!) + item.indent * INDENT);
  const boxWidth = (item: Laid) => (item.refs ? width : colX(col(item.box.data.level)!) + unit) - left(item) - 2;

  const chipGrid = (list: Box[], x0: number, inner: number, row0: number) => {
    const longest = Math.max(...list.map((chip) => chip.data.name.length));
    const chipW = Math.min(inner, Math.max(64, longest * 7.2 + 16));
    const per = Math.max(1, Math.floor((inner + GAP) / (chipW + GAP)));
    const w = Math.min(chipW * 1.6, (inner - GAP * (per - 1)) / per);
    list.forEach((box, i) => chips.push({ box, x: x0 + (i % per) * (w + GAP), y: HEAD + (row0 + Math.floor(i / per)) * ROW, w }));
    return Math.ceil(list.length / per);
  };
  // One box's children: owning groups first, capped with "+N more", then independent brands, folded when many.
  const layList = (parent: Box, list: Box[], row: number, isTop: boolean) => {
    let n = 0;
    const selves = list.filter((kid) => kid.data.self);
    const rest = list.filter((kid) => !kid.data.self);
    const limit = ctx.limits.get(parent.data.id) ?? (isTop ? LIMIT * 2 : LIMIT);
    for (const kid of rest.slice(0, limit)) n += lay(kid, row + n, 0);
    if (rest.length > limit) {
      extras.push({ parent, n: rest.length - limit, row: row + n, level: rest[limit].data.level });
      n += 1;
    }
    if (selves.length) {
      const fold = selves.length > FOLD_AT;
      const open = !fold || ctx.openIndependents.has(parent.data.id);
      if (fold) {
        toggles.push({ parent, n: selves.length, row: row + n, open });
        n += 1;
      }
      if (open) for (const kid of selves) n += lay(kid, row + n, 0);
    }
    return n;
  };
  const lay = (box: Box, row: number, indent: number, merged = false): number => {
    // An independent brand is its own owner: one box across the Owner and Brand columns.
    if (canMerge && box.data.self) {
      const own = (box.children ?? []).find((kid) => kid.data.level === 'brand');
      if (own) return lay(own, row, 0, true);
    }
    const item: Laid = { box, row, rows: 1, indent, merged, deeper: 0, refs: hostsRefs(box) };
    laid.push(item);
    if (item.refs) return (item.rows = 1 + chipGrid(box.children!, left(item) + 6, boxWidth(item) - 12, row + 1));
    const kids = box.children ?? [];
    const deeper = kids.filter((kid) => ORDER[kid.data.level] > ORDER[box.data.level] && col(kid.data.level) !== null);
    const same = kids.filter((kid) => kid.data.level === box.data.level);
    let n = layList(box, deeper, row, false);
    // Same-level children nest inside this box, below its own rows.
    if (same.length) {
      n = Math.max(n, 1);
      for (const kid of same) n += lay(kid, row + n, indent + 1);
    }
    item.deeper = deeper.length;
    return (item.rows = Math.max(1, n));
  };

  const top = f.children ?? [];
  const rows = hostsRefs(f) ? chipGrid(top, BAR + 6, width - BAR - 14, 0) : layList(f, top, 0, true);
  const frameLabel = (f.parent ? '‹ ' : '') + labelOf(ctx, f);
  // Tall enough for the zoomed box's name, which runs down the bar on the left.
  const height = Math.max(HEAD + rows * ROW + 4, HEAD + Math.min(240, frameLabel.length * 8 + 24));
  const y = (row: number) => HEAD + row * ROW;
  const html: string[] = [];

  if (hostsRefs(f)) html.push(`<div class="colhead" style="left:${BAR + 8}px">References</div>`);
  else columns.forEach((level, i) => html.push(`<div class="colhead" style="left:${colX(i) + 8}px">${LEVEL_NAMES[level]}${i === last && wide ? ' and its references' : ''}</div>`));

  html.push(
    `<button type="button" class="frame lv-${f.data.level}" data-act="out" style="top:${HEAD}px;height:${height - HEAD - 4}px" ${f.parent ? `aria-label="Zoom out from ${escape(labelOf(ctx, f))}"` : 'disabled'}><span>${escape(frameLabel)}</span></button>`,
  );

  const facts = (item: Laid) => [item.merged ? 'Independent' : null, measureText(item.box.data, state.sort), describe(item.box.data)].filter(Boolean) as string[];
  laid.forEach((item, i) => {
    const { box } = item;
    const oneLine = item.rows === 1 || item.refs || (box.children ?? []).some((kid) => kid.data.level === box.data.level);
    const w = boxWidth(item);
    const brand = box.data.level === 'brand' ? box.data.brand : undefined;
    const logo = w > 140 ? logoHtml(brand, 34, 14, 'plate') : '';
    const before = prefix ? brandOfBox(ctx, box)?.name : undefined;
    const list = facts(item);
    const shownFacts = oneLine ? list.slice(0, item.merged && measureText(box.data, state.sort) ? 2 : 1) : list;
    const classes = ['cell', `lv-${item.merged ? 'owner' : box.data.level}`, isContext(box) && 'ghost', isMatch(ctx, box) && 'match', box.data.eid === state.selected && 'sel', oneLine ? 'one' : 'two']
      .filter(Boolean)
      .join(' ');
    html.push(
      `<button type="button" class="${classes}" data-i="${i}" tabindex="-1" style="left:${left(item)}px;top:${y(item.row)}px;width:${w}px;height:${item.rows * ROW - 2}px" aria-label="${escape(
        [LEVEL_NAMES[box.data.level], before, labelOf(ctx, box), ...list].filter(Boolean).join(', '),
      )}">${logo}<span class="nm">${before ? `<span class="pre">${escape(before)} · </span>` : ''}${escape(labelOf(ctx, box))}</span>${
        shownFacts.length ? `<span class="cnt">${escape(shownFacts.join(' · '))}</span>` : ''
      }</button>`,
    );
  });
  chips.forEach((chip, i) => {
    const classes = ['chip-ref', isMatch(ctx, chip.box) && 'match', chip.box.data.eid === state.selected && 'sel'].filter(Boolean).join(' ');
    html.push(
      `<button type="button" class="${classes}" data-c="${i}" tabindex="-1" style="left:${chip.x}px;top:${chip.y}px;width:${chip.w}px;height:${ROW - 4}px" aria-label="Reference ${escape(chip.box.data.name)}">${escape(chip.box.data.name)}</button>`,
    );
  });
  if (ctx.showGaps) {
    // Anything shown with nothing catalogued below it, where deeper columns are in view.
    for (const item of laid) {
      const at = levelIndex(item.box.data);
      const c = col(item.box.data.level);
      if (item.deeper || item.refs || at < 1 || at >= ctx.to || isContext(item.box) || c === null || c >= last) continue;
      html.push(`<div class="gap" style="left:${colX(c + 1)}px;top:${y(item.row)}px;width:${width - colX(c + 1) - 2}px;height:${ROW - 2}px">not catalogued</div>`);
    }
  }
  extras.forEach((extra, i) => {
    html.push(
      `<button type="button" class="more" data-more="${i}" style="left:${colX(col(extra.level)!)}px;top:${y(extra.row)}px;width:${unit - 2}px;height:${ROW - 2}px">+ ${extra.n} more ${LEVEL_NAMES[extra.level].toLowerCase()}${extra.n === 1 ? '' : 's'} · show all</button>`,
    );
  });
  toggles.forEach((toggle, i) => {
    const x = colX(col('owner') ?? 0);
    html.push(
      `<button type="button" class="more" data-toggle="${i}" aria-expanded="${toggle.open}" style="left:${x}px;top:${y(toggle.row)}px;width:${width - x - 2}px;height:${ROW - 2}px">${toggle.open ? '▾' : '▸'} ${toggle.n.toLocaleString('en-US')} independent brands · ${toggle.open ? 'hide' : 'show'}</button>`,
    );
  });

  const board = document.createElement('div');
  board.className = 'columns';
  board.style.height = `${height}px`;
  board.innerHTML = html.join('');
  host.replaceChildren(board);

  // Clicking a box selects it and zooms in where it holds anything.
  board.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!target) return;
    if (target.dataset.act === 'out' && f.parent) ctx.zoomTo(f.parent);
    else if (target.dataset.i) ctx.select(laid[+target.dataset.i].box, true);
    else if (target.dataset.c) ctx.select(chips[+target.dataset.c].box, false);
    else if (target.dataset.more) ctx.showAll(extras[+target.dataset.more].parent);
    else if (target.dataset.toggle) ctx.toggleIndependents(toggles[+target.dataset.toggle].parent);
  });

  // Keyboard: one box takes Tab at a time; the arrow keys move between boxes, Enter zooms in, Escape zooms out.
  type Stop = { el: HTMLElement; box: Box; column: number; row: number; x: number };
  const stops: Stop[] = [
    ...laid.map((item, i) => ({ el: board.querySelector<HTMLElement>(`[data-i="${i}"]`)!, box: item.box, column: item.merged ? col('owner')! : col(item.box.data.level)!, row: item.row, x: 0 })),
    ...chips.map((chip, i) => ({ el: board.querySelector<HTMLElement>(`[data-c="${i}"]`)!, box: chip.box, column: columns.length, row: (chip.y - HEAD) / ROW, x: chip.x })),
  ];
  const current = stops.find((stop) => stop.box.data.eid === state.selected) ?? stops[0];
  if (current) current.el.tabIndex = 0;
  const move = (from: Stop, to: Stop | undefined) => {
    if (!to) return;
    from.el.tabIndex = -1;
    to.el.tabIndex = 0;
    to.el.focus();
  };
  board.addEventListener('keydown', (event) => {
    const here = stops.find((stop) => stop.el === document.activeElement);
    if (!here) return;
    const near = (list: Stop[]) => list.sort((a, b) => Math.abs(a.row - here.row) - Math.abs(b.row - here.row) || a.x - b.x)[0];
    let next: Stop | undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const down = event.key === 'ArrowDown';
      const sameColumn = stops
        .filter((stop) => stop.column === here.column && stop !== here)
        .filter((stop) => (down ? stop.row > here.row || (stop.row === here.row && stop.x > here.x) : stop.row < here.row || (stop.row === here.row && stop.x < here.x)));
      next = sameColumn.sort((a, b) => (down ? a.row - b.row || a.x - b.x : b.row - a.row || b.x - a.x))[0];
    } else if (event.key === 'ArrowRight') {
      next = stops.find((stop) => stop.box.parent === here.box) ?? near(stops.filter((stop) => stop.column === here.column + 1));
    } else if (event.key === 'ArrowLeft') {
      next = stops.find((stop) => stop.box === here.box.parent) ?? near(stops.filter((stop) => stop.column === here.column - 1));
    } else if (event.key === 'Home') next = stops.filter((stop) => stop.column === here.column)[0];
    else if (event.key === 'End') next = stops.filter((stop) => stop.column === here.column).at(-1);
    else if (event.key === 'Escape' && f.parent) {
      event.preventDefault();
      ctx.zoomTo(f.parent);
      return;
    } else return;
    event.preventDefault();
    move(here, next);
  });
}
