// Checks that brands carry the facts every brand needs, and that models agree with what their brand is said to make.
// Run as part of the catalog build, so a contradiction fails the build with a message naming the file to fix.
import type { CollectionEntry } from 'astro:content';
import knownGaps from '../data/known-gaps.json';

type Brand = CollectionEntry<'brands'>;
type Model = CollectionEntry<'models'>;
type Line = CollectionEntry<'lines'>;

// The facts every brand needs. A brand added from now on must have all of them; brands from before the rule are
// listed in src/data/known-gaps.json with the facts they still lack, and that list may only shrink.
export const brandFacts = {
  makes: (brand: Brand) => brand.data.makes.length > 0,
  owner: (brand: Brand) => brand.data.ownership.length > 0 || brand.data.independent !== undefined || brand.data.control !== undefined,
  origin: (brand: Brand) => brand.data.origin !== undefined,
  founded: (brand: Brand) => brand.data.periods.length > 0,
  segment: (brand: Brand) => brand.data.segment !== undefined,
};
export type BrandFact = keyof typeof brandFacts;

const describe: Record<BrandFact, string> = {
  makes: '`makes` (what it makes or has made)',
  owner: '`ownership`, or `independent` with a source',
  origin: '`origin`',
  founded: '`periods` (its founding year)',
  segment: '`segment`',
};

export const missingFacts = (brand: Brand) =>
  (Object.keys(brandFacts) as BrandFact[]).filter((fact) => !brandFacts[fact](brand));

// How much research a brand gets. Core brands may have no gaps at all; notable ones are researched fully;
// long-tail ones get one attempt per fact, and a miss is recorded so the search isn't repeated for a year.
export type Tier = 'core' | 'notable' | 'long-tail';
export const brandTier = (brand: Brand, brandsWithLines: Set<string>): Tier => {
  if (brand.data.priority) return brand.data.priority;
  if (brandsWithLines.has(brand.id) || brand.data.revenue.length > 0 || brand.data.production) return 'core';
  const wikipedia = JSON.stringify(brand.data).includes('wikipedia.org/');
  const owned = brand.data.ownership.some((record) => record.to === undefined);
  // Small high-end makers often have neither, so a luxury or haute segment counts too.
  const highEnd = brand.data.segment === 'luxury' || brand.data.segment === 'haute';
  return wikipedia || owned || highEnd ? 'notable' : 'long-tail';
};

// src/data/known-gaps.json: for each brand from before the rule, each fact it lacks, with `null` (not yet
// researched) or the date it was last searched for and not found.
type Gaps = Record<string, Partial<Record<BrandFact, string | null>>>;

export function checkBrandFacts(brands: Brand[], lines: Line[]) {
  const gaps = knownGaps as Gaps;
  const ids = new Set(brands.map((brand) => brand.id));
  const brandsWithLines = new Set(lines.map((line) => line.data.brand.id));
  for (const [id, facts] of Object.entries(gaps)) {
    if (!ids.has(id)) throw new Error(`src/data/known-gaps.json lists "${id}", which is not a brand. Remove it from the list.`);
    for (const [fact, searched] of Object.entries(facts)) {
      if (!(fact in brandFacts)) throw new Error(`src/data/known-gaps.json lists "${fact}" for "${id}", which is not a brand fact.`);
      if (searched !== null && !/^\d{4}-\d{2}-\d{2}$/.test(searched ?? '')) {
        throw new Error(`src/data/known-gaps.json gives "${id}" ${fact} as "${searched}"; use null or the date it was searched (YYYY-MM-DD).`);
      }
    }
  }
  for (const brand of brands) {
    const missing = missingFacts(brand);
    const allowed = Object.keys(gaps[brand.id] ?? {}) as BrandFact[];
    if (allowed.length > 0 && brandTier(brand, brandsWithLines) === 'core') {
      throw new Error(
        `Brand "${brand.id}" is a core brand, so it can't have gaps: fill in ${allowed.map((fact) => describe[fact]).join(', ')} ` +
          'and remove its entry from src/data/known-gaps.json.',
      );
    }
    const unlisted = missing.filter((fact) => !allowed.includes(fact));
    if (unlisted.length > 0) {
      throw new Error(
        `Brand "${brand.id}" is missing ${unlisted.map((fact) => describe[fact]).join(', ')}. ` +
          'Every new brand needs these, each with a source (see .claude/skills/add-brand).',
      );
    }
    const filled = allowed.filter((fact) => !missing.includes(fact));
    if (filled.length > 0) {
      throw new Error(
        `Brand "${brand.id}" now has ${filled.map((fact) => describe[fact]).join(', ')}. ` +
          `Remove ${filled.length === 1 ? 'it' : 'them'} from its entry in src/data/known-gaps.json.`,
      );
    }
  }
}

// A model may not contradict its brand's `makes`: a smartwatch needs `smartwatches`, a mechanical reference
// `mechanical-watches`, a quartz one `quartz-watches`. Fix whichever is wrong: the brand's list or the model.
export function checkModelsAgreeWithBrands(models: Model[], lines: Line[], brands: Brand[]) {
  const lineBrand = new Map(lines.map((line) => [line.id, line.data.brand.id]));
  const brandsById = new Map(brands.map((brand) => [brand.id, brand]));
  for (const line of lines) {
    const brand = brandsById.get(line.data.brand.id)!;
    const founded = brand.data.periods[0]?.from;
    const launched = line.data.periods[0]?.from;
    if (founded !== undefined && launched !== undefined && launched < founded) {
      throw new Error(`Line "${line.id}" is dated ${launched}, before "${brand.id}" was founded in ${founded}. One of the two years is wrong.`);
    }
  }
  for (const model of models) {
    const brand = brandsById.get(lineBrand.get(model.data.line.id)!)!;
    const makes = brand.data.makes;
    const file = `src/data/brands/${brand.id}.yaml`;
    if (makes.length === 0) {
      throw new Error(`Brand "${brand.id}" has models but no \`makes\`. Fill in what it makes in ${file}.`);
    }
    if (model.data.style === 'smartwatch' && !makes.includes('smartwatches')) {
      throw new Error(`Model "${model.id}" is a smartwatch, but ${file} does not list \`smartwatches\` in \`makes\`.`);
    }
    const founded = brand.data.periods[0]?.from;
    for (const reference of model.data.references) {
      const released = reference.periods[0]?.from;
      if (founded !== undefined && released !== undefined && released < founded) {
        throw new Error(
          `Reference ${reference.ref} of "${model.id}" is dated ${released}, before "${brand.id}" was founded in ${founded}. One of the two years is wrong.`,
        );
      }
      const kind = reference.movementType;
      const needed = kind === 'mechanical' ? 'mechanical-watches' : kind === 'quartz' ? 'quartz-watches' : undefined;
      if (needed && !makes.includes(needed)) {
        throw new Error(`Reference ${reference.ref} of "${model.id}" is ${kind}, but ${file} does not list \`${needed}\` in \`makes\`.`);
      }
    }
  }
}
