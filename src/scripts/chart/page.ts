import type { ChartPayload } from '../../lib/chart-payload';
import { renderColumns } from './columns';
import { escape, flagOf, labelOf, pathOf, type Box, type Context } from './common';
import { renderInfo, renderOutline } from './outline';
import {
  build,
  countriesOf,
  indexPayload,
  LEVEL_NAMES,
  LEVEL_PLURALS,
  LEVELS,
  matches,
  NOT_RECORDED,
  passesFilters,
  SEGMENTS,
  segmentName,
  statusOf,
  UNRECORDED,
  type Built,
  type CountryMeaning,
  type GroupBy,
  type Hit,
  type Sort,
  type View,
} from './tree';
import { readState, writeState } from './url';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const payload: ChartPayload = JSON.parse($('chart-data').textContent!);
const index = indexPayload(payload);
// Marks for missing data are for whoever is filling it in, so they show on the dev server only.
const showGaps = import.meta.env.DEV;

const allCountries = new Set([
  ...Object.keys(payload.flags),
  ...payload.brands.flatMap((brand) => [brand.origin, brand.headquarters, ...brand.madeIn]),
  ...payload.groups.map((group) => group.country),
].filter((country): country is string => !!country));

const MEANINGS: { id: CountryMeaning; label: string; note: string; has: (brand: ChartPayload['brands'][number]) => boolean }[] = [
  { id: 'origin', label: 'Origin', note: 'where the brand was founded', has: (brand) => !!brand.origin },
  { id: 'owner', label: "Owner's home", note: 'its direct owner, or its origin if independent', has: (brand) => countriesOf(index, brand, 'owner')[0] !== UNRECORDED },
  { id: 'hq', label: 'Headquarters', note: 'where it is run from', has: (brand) => !!brand.headquarters },
  { id: 'made', label: 'Made in', note: 'where the watches are made', has: (brand) => brand.madeIn.length > 0 },
];
const EUROPE = ['Austria', 'Belarus', 'Belgium', 'Croatia', 'Czech Republic', 'Denmark', 'East Germany', 'Estonia', 'Finland', 'France', 'Germany', 'Hungary', 'Ireland', 'Italy', 'Lithuania', 'Luxembourg', 'Netherlands', 'Norway', 'Poland', 'Portugal', 'Russia', 'Spain', 'Sweden', 'Switzerland', 'Ukraine', 'United Kingdom'];
const PRESETS: [string, string[]][] = [
  ['Switzerland', ['Switzerland']],
  ['Japan', ['Japan']],
  ['Germany', ['Germany']],
  ['United States', ['United States']],
  ['Europe', EUROPE],
  ['Europe without Switzerland', EUROPE.filter((country) => country !== 'Switzerland')],
  ['Asia', ['China', 'Hong Kong', 'India', 'Indonesia', 'Israel', 'Japan', 'Philippines', 'Qatar', 'Singapore', 'South Korea', 'Taiwan', 'Thailand']],
  ['Americas', ['Brazil', 'Canada', 'Mexico', 'United States']],
  ['Not recorded', [UNRECORDED]],
];
const STATUS_NAMES: Record<string, string> = { trading: 'Trading', 'not-trading': 'Not trading' };
const countryName = (country: string) => (country === UNRECORDED ? NOT_RECORDED : country);
const segmentLabel = (segment: string) => (segment === UNRECORDED ? NOT_RECORDED : segmentName(segment));
const tally = <T>(items: T[], key: (item: T) => string[]) => {
  const counts = new Map<string, number>();
  for (const item of items) for (const k of key(item)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return counts;
};

// ---------- state ----------

const initial = readState(location.search, allCountries);
let { state, viewGiven } = initial;
if (!viewGiven && innerWidth < 640) state.view = 'outline';
let notes: string[] = initial.dropped.length ? [`Left out of the link, as the page doesn't know them: ${initial.dropped.join(', ')}.`] : [];
const limits = new Map<string, number>();
const openIndependents = new Set<string>();
const expanded = new Set<string>();
let built: Built;
let to = state.to;
let focus: Box;

const find = (eid: string | null) => (eid ? built.top.find((box) => box.data.eid === eid) : undefined);

function update({ push = false } = {}) {
  const before = focus;
  to = state.to;
  built = build(index, state, to, state.focus);
  // Never draw an empty level: step back to the deepest one with data.
  if (to > state.from && !built.root.counts[LEVELS[to]]) {
    while (to > state.from && !built.root.counts[LEVELS[to]]) to--;
    notes.push(`No ${LEVEL_PLURALS[LEVELS[state.to]].toLowerCase()} recorded for this selection, so the chart stops at ${LEVEL_PLURALS[LEVELS[to]].toLowerCase()}.`);
    built = build(index, state, to, state.focus);
  }
  // The item zoomed into is kept by its id; where it has left the view, zoom out to its nearest ancestor in view.
  let found = find(state.focus);
  if (state.focus && !found) {
    found = index.ancestorsOf(state.focus).map(find).find(Boolean);
    const name = before?.data.eid === state.focus ? `${before.data.name} (${LEVEL_NAMES[before.data.level].toLowerCase()})` : 'The item zoomed into';
    notes.push(`${name} isn't in the levels or filters shown, so the view zoomed out to ${found ? found.data.name : 'everything'}.`);
  }
  focus = found ?? built.top;
  state.focus = focus === built.top ? null : focus.data.eid;
  if (state.selected && !find(state.selected)) state.selected = null;

  const query = writeState(state, viewGiven);
  if (query !== location.search) history[push ? 'pushState' : 'replaceState'](null, '', location.pathname + query);
  render();
}

const context = (): Context => ({
  index,
  state,
  built,
  to,
  focus,
  limits,
  openIndependents,
  expanded,
  showGaps,
  select: (box, zoom) => {
    state.selected = box.data.eid;
    const zooming = zoom && !!box.children && box !== focus;
    if (zooming) state.focus = box.data.eid;
    keepFocus = true;
    update({ push: zooming });
  },
  zoomTo: (box) => {
    state.focus = box === built.top ? null : box.data.eid;
    state.selected = box.data.eid;
    keepFocus = true;
    update({ push: true });
  },
  showAll: (box) => {
    limits.set(box.data.id, Infinity);
    render();
  },
  toggleIndependents: (box) => {
    if (!openIndependents.delete(box.data.id)) openIndependents.add(box.data.id);
    render();
  },
  toggleRow: (box) => {
    if (!expanded.delete(box.data.id)) expanded.add(box.data.id);
    state.selected = box.data.eid;
    keepFocus = true;
    update();
  },
});

// After a click or key press redraws the chart, the box acted on takes the focus again.
let keepFocus = false;

function render() {
  const ctx = context();
  renderControls();
  renderStatus();
  renderCrumbs(ctx);
  const viz = $('viz');
  if (!built.top.children) {
    viz.innerHTML = `<p class="empty">Nothing matches. ${
      state.from >= 2 ? `No brand left by these filters has ${LEVEL_PLURALS[LEVELS[state.from]].toLowerCase()} recorded yet.` : 'Try fewer filters.'
    }</p>`;
  } else if (state.view === 'columns') renderColumns(viz, ctx);
  else renderOutline(viz, ctx);
  renderInfo($('info'), ctx, find(state.selected) ?? focus);
  renderLegend();
  if (keepFocus) {
    keepFocus = false;
    viz.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  }
}

// ---------- controls ----------

function renderControls() {
  const brands = payload.brands;
  $('cmodes').innerHTML =
    '<span class="lab">Country means</span>' +
    MEANINGS.map(
      (meaning) =>
        `<label><input type="radio" name="cmode" value="${meaning.id}" ${state.countryMeaning === meaning.id ? 'checked' : ''}> ${meaning.label} <small>${
          brands.filter(meaning.has).length
        } recorded</small></label>`,
    ).join('');
  const counts = tally(
    brands.filter((brand) => passesFilters(index, state, brand, true)),
    (brand) => countriesOf(index, brand, state.countryMeaning),
  );
  const names = [...new Set([...allCountries, UNRECORDED])].filter((country) => counts.get(country) || state.countries.has(country));
  names.sort((a, b) => (a === UNRECORDED ? 1 : b === UNRECORDED ? -1 : (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b)));
  $('clist').innerHTML = names
    .map(
      (country) =>
        `<label class="${counts.get(country) ? '' : 'zero'}"><input type="checkbox" value="${escape(country)}" ${state.countries.has(country) ? 'checked' : ''}><span>${flagOf(
          index,
          country,
        )}</span><span>${escape(countryName(country))}</span><span>${counts.get(country) ?? 0}</span></label>`,
    )
    .join('');
  $('csum').textContent =
    state.countries.size === 0
      ? 'All countries'
      : state.countries.size <= 2
        ? [...state.countries].map((country) => `${flagOf(index, country)} ${countryName(country)}`.trim()).join(', ')
        : `${state.countries.size} countries`;

  const segments = [...SEGMENTS, UNRECORDED];
  const segmentCounts = tally(brands, (brand) => [brand.segment ?? UNRECORDED]);
  const statusCounts = tally(brands, (brand) => [statusOf(brand)]);
  $('mpanel').innerHTML = `<fieldset><legend>Segment</legend>${segments
    .map(
      (segment) =>
        `<label><input type="checkbox" data-k="segments" value="${segment}" ${state.segments.has(segment) ? 'checked' : ''}> ${segmentLabel(segment)} <small>${
          segmentCounts.get(segment) ?? 0
        }</small></label>`,
    )
    .join('')}</fieldset>
    <fieldset><legend>Status</legend>${Object.entries(STATUS_NAMES)
      .map(
        ([id, name]) =>
          `<label><input type="checkbox" data-k="status" value="${id}" ${state.status.has(id) ? 'checked' : ''}> ${name} <small>${statusCounts.get(id) ?? 0}</small></label>`,
      )
      .join('')}</fieldset>`;
  const more = state.segments.size + state.status.size;
  $('msum').textContent = more ? `${more} selected` : 'Segment, status';

  // The levels list how many of each the filters leave, so an empty level reads as 0 and can't be picked.
  const counted = built.root.counts;
  const option = (i: number, selected: boolean, disabled: boolean) =>
    `<option value="${i}" ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${LEVEL_PLURALS[LEVELS[i]]} (${counted[LEVELS[i]].toLocaleString('en-US')})</option>`;
  $('lvfrom').innerHTML = LEVELS.map((level, i) => option(i, i === state.from, !counted[level])).join('');
  $('lvto').innerHTML = LEVELS.map((level, i) => option(i, i === to, i < state.from || !counted[level])).join('');
  $('track').innerHTML = LEVELS.map((level, i) => `<i class="${i >= state.from && i <= to ? 'on' : ''}" title="${LEVEL_PLURALS[level]}"></i>`).join('');
  $<HTMLSelectElement>('groupby').value = state.groupBy;
  $<HTMLSelectElement>('indep').value = state.independents;
  $<HTMLSelectElement>('sort').value = state.sort;
  for (const button of document.querySelectorAll<HTMLButtonElement>('#views button')) button.setAttribute('aria-pressed', String(button.dataset.v === state.view));
}

function renderStatus() {
  const c = built.root.counts;
  const parts = [
    `<span><b>${built.shown.toLocaleString('en-US')}</b> brands · <b>${c.line}</b> lines · <b>${c.model}</b> models · <b>${c.ref}</b> references</span>`,
  ];
  const meaning = MEANINGS.find((m) => m.id === state.countryMeaning)!.label.toLowerCase();
  for (const country of state.countries)
    parts.push(
      `<span class="fchip">${flagOf(index, country)} ${escape(countryName(country))} <small>(${meaning})</small><button type="button" data-rm="c" data-v="${escape(country)}" aria-label="Remove ${escape(countryName(country))}">×</button></span>`,
    );
  for (const segment of state.segments)
    parts.push(`<span class="fchip">${segmentLabel(segment)}<button type="button" data-rm="s" data-v="${segment}" aria-label="Remove ${segmentLabel(segment)}">×</button></span>`);
  for (const status of state.status)
    parts.push(`<span class="fchip">${STATUS_NAMES[status]}<button type="button" data-rm="t" data-v="${status}" aria-label="Remove ${STATUS_NAMES[status]}">×</button></span>`);
  if (state.independents === 'hide') parts.push('<span class="fchip">Independents hidden<button type="button" data-rm="i" aria-label="Show independent brands">×</button></span>');
  if (state.q) parts.push(`<span class="fchip">“${escape(state.q)}”<button type="button" data-rm="q" aria-label="Clear search">×</button></span>`);
  if (showGaps && to >= 2 && c.brand) {
    let without = 0;
    built.top.each((box) => {
      if (box.data.level === 'brand' && !box.data.context && !index.linesOf.has(box.data.brand!.id)) without++;
    });
    if (without) parts.push(`<span>${without} of ${c.brand} brands have no lines recorded <span class="tag">dev only</span></span>`);
  }
  const outside = built.search && !c.brand && built.search.hits.length;
  if (outside)
    parts.push(`<span class="warn">${outside} match${outside === 1 ? '' : 'es'} outside these filters</span><button type="button" class="link" data-rm="filters">Search everything</button>`);
  for (const note of notes) parts.push(`<span class="warn">${escape(note)}</span>`);
  notes = [];
  if (state.countries.size || state.segments.size || state.status.size || state.q || state.independents === 'hide')
    parts.push('<button type="button" class="link" data-rm="all">Reset</button>');
  $('status').innerHTML = parts.join('');
}

function renderCrumbs(ctx: Context) {
  const chain = pathOf(focus);
  $('crumbs').innerHTML = chain
    .map((box, i) =>
      i === chain.length - 1
        ? `<span class="here" aria-current="location">${escape(labelOf(ctx, box))}</span>`
        : `<button type="button" data-i="${i}">${escape(labelOf(ctx, box))}</button><span class="sep" aria-hidden="true">›</span>`,
    )
    .join('');
  $('crumbs').onclick = (event) => {
    const i = (event.target as HTMLElement).closest<HTMLElement>('button')?.dataset.i;
    if (i !== undefined) ctx.zoomTo(chain[+i]);
  };
}

function renderLegend() {
  const shown = LEVELS.slice(state.from, to + 1);
  $('legend').innerHTML =
    (state.groupBy !== 'none' ? '<span><i class="lv-lens"></i>Group</span>' : '') +
    shown.map((level) => `<span><i class="lv-${level}"></i>${LEVEL_NAMES[level]}</span>`).join('') +
    '<span><i class="ghost"></i>Context (filtered out)</span>' +
    (showGaps && to >= 2 ? '<span><i class="gap"></i>Not catalogued yet (dev only)</span>' : '') +
    (state.q ? '<span><i class="match"></i>Matches search</span>' : '');
}

// ---------- search ----------

let results: Hit[] = [];
let active = -1;
const levelRank = (hit: Hit) => LEVELS.indexOf(hit.level);
function showResults() {
  const q = state.q.trim().toLowerCase();
  results = q
    ? index.entries
        .filter((hit) => matches(hit, q))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || levelRank(a) - levelRank(b))
        .slice(0, 10)
    : [];
  active = -1;
  const box = $('results');
  box.hidden = !results.length;
  $('q').setAttribute('aria-expanded', String(results.length > 0));
  box.innerHTML = results
    .map((hit, i) => {
      const brand = hit.brand;
      const outside = brand && !passesFilters(index, { ...state, q: '' }, brand);
      return `<button type="button" role="option" id="hit-${i}" data-i="${i}"><span class="tag">${LEVEL_NAMES[hit.level]}</span><span>${escape(hit.name)}<small>${escape(hit.detail)}${
        outside ? ' · outside filters' : ''
      }</small></span></button>`;
    })
    .join('');
}

// Jumps to a search result: brings its level into range, then zooms to it, clearing filters if they hide it.
function jump(hit: Hit) {
  $('results').hidden = true;
  const need = LEVELS.indexOf(hit.level);
  if (need > state.to) state.to = need;
  if (need < state.from) state.from = need;
  const zoomTo = () => {
    built = build(index, state, state.to, null);
    const box = find(hit.eid);
    if (!box) return false;
    state.selected = hit.eid;
    const frame = box.children ? box : (box.parent ?? box);
    state.focus = frame === built.top ? null : frame.data.eid;
    return true;
  };
  if (!zoomTo() && (state.countries.size || state.segments.size || state.status.size || state.independents === 'hide')) {
    state.countries.clear();
    state.segments.clear();
    state.status.clear();
    state.independents = 'show';
    notes.push(`Filters cleared to show ${hit.name}, which was outside them.`);
    zoomTo();
  }
  update({ push: true });
}

const input = $<HTMLInputElement>('q');
input.value = state.q;
input.addEventListener('input', () => {
  state.q = input.value;
  state.focus = null;
  showResults();
  update();
});
input.addEventListener('keydown', (event) => {
  if (!results.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    active = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    [...$('results').children].forEach((button, i) => button.classList.toggle('on', i === active));
    input.setAttribute('aria-activedescendant', `hit-${active}`);
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    jump(results[Math.max(0, active)]);
  }
  if (event.key === 'Escape') $('results').hidden = true;
});
$('results').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('button');
  if (button) jump(results[+button.dataset.i!]);
});
document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  if (!target.closest('.search')) $('results').hidden = true;
  for (const pop of document.querySelectorAll<HTMLDetailsElement>('details.pop[open]')) if (!pop.contains(target)) pop.open = false;
});

// ---------- control events ----------

const filtersChanged = () => update();
$('cmodes').addEventListener('change', (event) => {
  state.countryMeaning = (event.target as HTMLInputElement).value as CountryMeaning;
  state.countries.clear();
  filtersChanged();
});
$('clist').addEventListener('change', (event) => {
  const box = event.target as HTMLInputElement;
  if (box.checked) state.countries.add(box.value);
  else state.countries.delete(box.value);
  filtersChanged();
});
$('presets').innerHTML = PRESETS.map(([name], i) => `<button type="button" data-p="${i}">${name}</button>`).join('') + '<button type="button" data-p="clear">Clear</button>';
$('presets').addEventListener('click', (event) => {
  const preset = (event.target as HTMLElement).dataset.p;
  if (preset === undefined) return;
  state.countries = new Set(preset === 'clear' ? [] : PRESETS[+preset][1].filter((country) => allCountries.has(country) || country === UNRECORDED));
  filtersChanged();
});
$('mpanel').addEventListener('change', (event) => {
  const box = event.target as HTMLInputElement;
  const set = state[box.dataset.k as 'segments' | 'status'];
  if (box.checked) set.add(box.value);
  else set.delete(box.value);
  filtersChanged();
});
$('groupby').addEventListener('change', (event) => {
  state.groupBy = (event.target as HTMLSelectElement).value as GroupBy;
  update();
});
$('sort').addEventListener('change', (event) => {
  state.sort = (event.target as HTMLSelectElement).value as Sort;
  update();
});
$('indep').addEventListener('change', (event) => {
  state.independents = (event.target as HTMLSelectElement).value as 'show' | 'hide';
  filtersChanged();
});
$('lvfrom').addEventListener('change', (event) => {
  state.from = +(event.target as HTMLSelectElement).value;
  if (state.to < state.from) state.to = state.from;
  update();
});
$('lvto').addEventListener('change', (event) => {
  state.to = +(event.target as HTMLSelectElement).value;
  if (state.from > state.to) state.from = state.to;
  update();
});
$('views').addEventListener('click', (event) => {
  const view = (event.target as HTMLElement).closest<HTMLElement>('button')?.dataset.v as View | undefined;
  if (!view) return;
  state.view = view;
  viewGiven = true;
  update();
});
$('status').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('button');
  const kind = button?.dataset.rm;
  if (!kind) return;
  const value = button.dataset.v!;
  if (kind === 'c') state.countries.delete(value);
  if (kind === 's') state.segments.delete(value);
  if (kind === 't') state.status.delete(value);
  if (kind === 'i') state.independents = 'show';
  if (kind === 'q' || kind === 'all') input.value = state.q = '';
  if (kind === 'filters' || kind === 'all') {
    state.countries.clear();
    state.segments.clear();
    state.status.clear();
    state.independents = 'show';
  }
  update();
});

// Back and Forward step through zooms; the state comes from the link each time.
addEventListener('popstate', () => {
  const read = readState(location.search, allCountries);
  const keepView = !read.viewGiven ? state.view : read.state.view;
  state = read.state;
  state.view = keepView;
  viewGiven = read.viewGiven;
  input.value = state.q;
  update();
});

let resizing: ReturnType<typeof setTimeout>;
let lastWidth = $('viz').clientWidth;
new ResizeObserver(() => {
  clearTimeout(resizing);
  resizing = setTimeout(() => {
    const width = $('viz').clientWidth;
    if (width !== lastWidth && state.view === 'columns') render();
    lastWidth = width;
  }, 120);
}).observe($('viz'));

update();
