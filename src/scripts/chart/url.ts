import { LEVELS, SEGMENTS, SORTS, UNRECORDED, type CountryMeaning, type GroupBy, type Level, type Sort, type State, type View } from './tree';

// The Chart page keeps its state in the query string, so any view can be linked to and Back undoes a zoom.
//   /chart/?c=Switzerland,Japan&cby=owner&by=country&levels=brand-model&sort=age&focus=g:swatch-group
// Values left at their defaults are left out. Values the page doesn't know are dropped, with a note saying so.

export const defaults = (): State => ({
  q: '',
  countries: new Set(),
  countryMeaning: 'origin',
  segments: new Set(),
  status: new Set(),
  groupBy: 'none',
  // Opens on brands and their lines; owners are a level up.
  from: 1,
  to: 2,
  independents: 'show',
  sort: 'count',
  view: 'columns',
  focus: null,
  selected: null,
});

const MEANINGS: CountryMeaning[] = ['origin', 'owner', 'hq', 'made'];
const GROUPINGS: GroupBy[] = ['none', 'country', 'segment', 'era'];
const VIEWS: View[] = ['columns', 'outline'];
const STATUSES = ['trading', 'not-trading'];
const list = (value: string | null) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []);

// Reads the state from a query string. `countries` is every country the filter can pick. `view` is left unset
// unless the link names one, so the page can choose by screen width.
export function readState(query: string, countries: Set<string>): { state: State; viewGiven: boolean; dropped: string[] } {
  const params = new URLSearchParams(query);
  const state = defaults();
  const dropped: string[] = [];
  const pick = <T extends string>(key: string, allowed: readonly T[], set: (value: T) => void) => {
    const value = params.get(key);
    if (value === null) return;
    if ((allowed as readonly string[]).includes(value)) set(value as T);
    else dropped.push(`${key}=${value}`);
  };
  const pickMany = (key: string, allowed: Set<string>, into: Set<string>) => {
    for (const value of list(params.get(key))) {
      if (allowed.has(value)) into.add(value);
      else dropped.push(`${key}=${value}`);
    }
  };

  state.q = params.get('q') ?? '';
  pickMany('c', new Set([...countries, UNRECORDED]), state.countries);
  pick('cby', MEANINGS, (value) => (state.countryMeaning = value));
  pickMany('seg', new Set([...SEGMENTS, UNRECORDED]), state.segments);
  pickMany('status', new Set(STATUSES), state.status);
  pick('by', GROUPINGS, (value) => (state.groupBy = value));
  pick('sort', SORTS.map((sort) => sort.id), (value: Sort) => (state.sort = value));
  pick('indep', ['show', 'hide'] as const, (value) => (state.independents = value));
  pick('view', VIEWS, (value) => (state.view = value));
  const levels = params.get('levels');
  if (levels !== null) {
    const [from, to = from] = levels.split('-').map((name) => LEVELS.indexOf(name as Level));
    if (from >= 0 && to >= from) [state.from, state.to] = [from, to];
    else dropped.push(`levels=${levels}`);
  }
  // Checked against the tree once it's built, since an item may be filtered out.
  state.focus = params.get('focus') || null;
  return { state, viewGiven: params.has('view') && !dropped.some((item) => item.startsWith('view=')), dropped };
}

// The query string for a state, starting with `?`, or empty for the default view.
export function writeState(state: State, viewGiven: boolean): string {
  const params = new URLSearchParams();
  const base = defaults();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.countries.size) params.set('c', [...state.countries].join(','));
  if (state.countryMeaning !== base.countryMeaning) params.set('cby', state.countryMeaning);
  if (state.segments.size) params.set('seg', [...state.segments].join(','));
  if (state.status.size) params.set('status', [...state.status].join(','));
  if (state.groupBy !== base.groupBy) params.set('by', state.groupBy);
  if (state.from !== base.from || state.to !== base.to)
    params.set('levels', state.from === state.to ? LEVELS[state.from] : `${LEVELS[state.from]}-${LEVELS[state.to]}`);
  if (state.sort !== base.sort) params.set('sort', state.sort);
  if (state.independents !== base.independents) params.set('indep', state.independents);
  if (viewGiven) params.set('view', state.view);
  if (state.focus) params.set('focus', state.focus);
  const text = params.toString().replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%2F/g, '/');
  return text ? `?${text}` : '';
}
