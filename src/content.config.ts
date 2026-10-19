import { defineCollection, reference, type SchemaContext } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { countryNames } from './lib/countries';
import { refSlug } from './lib/slug';

// Where a fact was taken from, as links a reader can check. Empty means it is unsourced.
const sources = z.array(z.url()).default([]);

const country = z.enum(countryNames);

const currency = z.enum(['USD', 'CHF', 'EUR', 'GBP', 'JPY', 'HKD', 'INR', 'CNY']);

// Revenue for one financial year, as published in accounts (`reported`) or estimated by analysts (`estimate`).
// Most watch brands are private or part of a group that does not split out its brands, so estimates are common.
// `year` is the calendar year most of the financial year falls in: Richemont's year to March 2026 is 2025.
const revenue = z
  .array(
    z.object({
      year: z.number().int(),
      amount: z.number().positive(),
      currency,
      basis: z.enum(['reported', 'estimate']),
      sources: sources.refine((list) => list.length > 0, { message: 'A revenue figure needs at least one source.' }),
    }),
  )
  .refine((list) => new Set(list.map(({ year }) => year)).size === list.length, {
    message: 'Give each year one revenue figure.',
  })
  .default([]);

// Where an image file came from and on what terms. `author` and `licenseUrl` are for licenses that require a credit.
const credit = z
  .object({ source: z.url(), license: z.string(), licenseUrl: z.url().optional(), author: z.string().optional() })
  .optional();

// A brand's or group's logo, with where the file came from and on what terms.
const logoFields = (image: SchemaContext['image']) => ({
  // An image file, given as a path from the record's own file, e.g. `../logos/rolex.svg`. A missing file fails the build.
  logo: image().optional(),
  logoCredit: credit,
  // The logo's parts, where it has them: its symbol alone (LV's monogram) and its name alone. Each is shown in its
  // place where the whole logo would be too small to read. A part cut from the logo's own file is covered by
  // `logoCredit`; one from another file needs its own credit.
  logomark: image().optional(),
  logomarkCredit: credit,
  wordmark: image().optional(),
  wordmarkCredit: credit,
});
type LogoRecord = Partial<Record<'logo' | 'logoCredit' | 'logomark' | 'logomarkCredit' | 'wordmark' | 'wordmarkCredit', unknown>>;
const creditHasLogo = (record: LogoRecord) =>
  (record.logoCredit === undefined || record.logo !== undefined) &&
  (record.logomarkCredit === undefined || record.logomark !== undefined) &&
  (record.wordmarkCredit === undefined || record.wordmark !== undefined);
const creditNeedsLogo = { message: 'A `logoCredit`, `logomarkCredit` or `wordmarkCredit` needs its file to credit.' };
const partsNeedLogo = (record: LogoRecord) => (record.logomark === undefined && record.wordmark === undefined) || record.logo !== undefined;
const partsNeedLogoMessage = { message: 'A `logomark` or `wordmark` is a part of a `logo`: give the whole `logo` too.' };

const groups = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/data/groups' }),
  schema: ({ image }) =>
    z
      .object({
        name: z.string(),
        ...logoFields(image),
        country,
        // Who controls the company: listed on a stock exchange, held privately (a family, founder or partners),
        // or owned by a foundation. A group with a `parent` is a subsidiary and leaves this out.
        control: z.enum(['public', 'private', 'foundation']).optional(),
        founded: z.number().int().optional(),
        website: z.url().optional(),
        parent: reference('groups').optional(),
        // The whole company's revenue, including any business beyond its watch brands.
        revenue,
        // For the group's own facts; a brand it owns cites the ownership on the brand's record.
        sources,
      })
      .refine(creditHasLogo, creditNeedsLogo)
      .refine(partsNeedLogo, partsNeedLogoMessage)
      .refine((group) => (group.control === undefined) !== (group.parent === undefined), {
        message: 'Give a group either `control` or a `parent`: a subsidiary is controlled by its parent.',
      }),
});

const color = z.enum([
  'black', 'white', 'silver', 'gray', 'blue', 'green', 'red', 'yellow', 'orange', 'brown', 'pink', 'purple', 'gold', 'rose-gold', 'champagne',
]);
const metal = z.enum(['steel', 'aluminum', 'yellow-gold', 'white-gold', 'rose-gold', 'platinum', 'titanium', 'ceramic', 'bronze']);

const endsAfterStart = ({ from, to }: { from?: number; to?: number }) =>
  from === undefined || to === undefined || to >= from;

// A list of year ranges, oldest first. Only the last may be open-ended, and none may overlap.
const periods = z
  .array(
    z
      .object({ from: z.number().int(), to: z.number().int().optional() })
      .refine(endsAfterStart, { message: 'A period cannot end before it starts.' }),
  )
  .refine((list) => list.every((_, index) => index === 0 || list[index - 1].to !== undefined), {
    message: 'Only the last period may be open-ended; earlier ones need a `to` year.',
  })
  .refine((list) => list.every((entry, index) => index === 0 || entry.from >= (list[index - 1].to ?? entry.from)), {
    message: 'Periods must be in date order and must not overlap.',
  })
  .default([]);

// One holder's tenure (an owner or a licensee). The record with no `to` is the current one.
// Each record cites its own sources, since these are the dated claims most often disputed.
const tenure = { from: z.number().int().optional(), to: z.number().int().optional(), sources };
const tenureEnds = { message: 'A record cannot end before it starts.' };
const onlyOneCurrent = (list: { to?: number }[]) => list.filter((record) => record.to === undefined).length <= 1;
// The percentage of the brand an owner holds, or `unknown` for a part-owner whose share is not public.
// Leaving it out means the owner holds the whole brand.
const stake = z.union([z.number().gt(0).max(100), z.literal('unknown')]).optional();
// An owner is a group or another brand. A bare id means a group; `{ brand: tudor }` names a brand,
// since the two collections share ids (Chanel is both). Either way it resolves to a reference.
const owner = z.union([
  reference('groups'),
  z.object({ group: reference('groups') }).transform(({ group }) => group),
  z.object({ brand: reference('brands') }).transform(({ brand }) => brand),
]);
// How firmly an ownership claim is established: stated by the company, stated by the press, or circulating unconfirmed.
// It covers the whole record, so a disputed owner can be marked as well as a disputed stake.
const basis = z.enum(['disclosed', 'reported', 'rumored']).optional();
// Several owners can be current only as part-owners: each states its stake and the known ones total no more than the whole.
const currentStakesFit = (list: { to?: number; stake?: number | 'unknown' }[]) => {
  const current = list.filter((record) => record.to === undefined);
  const known = current.map((record) => record.stake).filter((share) => typeof share === 'number');
  return (
    current.length <= 1 ||
    (current.every((record) => record.stake !== undefined) && known.reduce((total, share) => total + share, 0) <= 100)
  );
};

const brands = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/data/brands' }),
  schema: ({ image }) =>
    z
      .object({
        name: z.string(),
        ...logoFields(image),
        // Three separate facts: where the brand was founded, where it is run from today, and where its watches are made.
        origin: country.optional(),
        headquarters: country.optional(),
        manufacturing: z.array(country).default([]),
        // The periods the brand traded, so a revived brand has several. A last period with no `to` is still running.
        periods,
        // An older business the brand claims descent from without having traded continuously since, e.g. a
        // modern company named after an 18th-century watchmaker. Kept apart from `periods`, which are the
        // brand's own trading years, and cited separately since such claims are often disputed.
        heritage: z
          .object({
            from: z.number().int(),
            sources: sources.refine((list) => list.length > 0, { message: 'A heritage claim needs at least one source.' }),
          })
          .optional(),
        // Only for brands with no periods recorded; otherwise status is derived from them.
        status: z.enum(['active', 'dormant', 'defunct', 'revived']).optional(),
        // Market positioning. `broad` is for brands whose range spans several tiers.
        segment: z.enum(['haute', 'luxury', 'mid-range', 'budget', 'broad']).optional(),
        // What the brand makes. A brand can make several; brands not yet looked into have none.
        makes: z.array(z.enum(['mechanical-watches', 'quartz-watches', 'smartwatches', 'movements', 'cases'])).default([]),
        // What kind of business it is, where that is not simply a watch brand. A brand can carry several.
        tags: z.array(z.enum(['fashion', 'direct-to-consumer', 'early-digital'])).default([]),
        copycat: z.boolean().default(false),
        // Watches made per year, with the year the figure refers to.
        production: z.object({ units: z.number().int(), year: z.number().int() }).optional(),
        // Revenue from this brand alone.
        revenue,
        website: z.url().optional(),
        // Ownership is dated because brands change hands; a record with no `to` is a current owner.
        ownership: z
          .array(
            z
              .object({ owner, stake, basis, ...tenure })
              .refine(endsAfterStart, tenureEnds)
              .refine((record) => record.basis === undefined || record.sources.length > 0, {
                message: 'A record with a `basis` needs at least one source to show where the claim comes from.',
              }),
          )
          .refine(currentStakesFit, {
            message:
              'Several owners can be current only if each has a `stake` (a percentage or `unknown`) and the percentages total 100 or less; otherwise give the earlier records a `to` year.',
          })
          .default([]),
        // Set only where sources confirm no group or other company owns the brand today; it then shows as
        // "Independent" in place of an owner. Earlier owners stay in `ownership` with a `to` year.
        independent: z
          .object({ sources: sources.refine((list) => list.length > 0, { message: 'Independence needs at least one source.' }) })
          .optional(),
        // Companies that make and sell the brand's watches under license without owning the brand. Dated like ownership.
        licensees: z
          .array(z.object({ licensee: reference('groups'), ...tenure }).refine(endsAfterStart, tenureEnds))
          .refine(onlyOneCurrent, { message: 'Only one licensee can be current; give the earlier records a `to` year.' })
          .default([]),
        // For facts on this brand other than ownership and licensing, which cite their own.
        sources,
      })
      .refine((brand) => brand.periods.length === 0 || brand.status === undefined, {
        message: 'Set either `periods` or `status`, not both: status is derived from periods.',
      })
      .refine((brand) => !brand.independent || brand.ownership.every((record) => record.to !== undefined), {
        message: 'An `independent` brand cannot have a current owner; give its ownership records a `to` year.',
      })
      .refine(creditHasLogo, creditNeedsLogo)
      .refine(partsNeedLogo, partsNeedLogoMessage)
      .refine((brand) => !brand.heritage || !brand.periods[0] || brand.heritage.from < brand.periods[0].from, {
        message: 'A `heritage` year comes before the brand’s own first period; otherwise it belongs in `periods`.',
      }),
});

// A product line (collection) sold under a brand's name, e.g. Rolex Submariner. Files live at lines/<brand>/<line>.yaml.
const lines = defineCollection({
  loader: glob({ pattern: '*/*.yaml', base: './src/data/lines' }),
  schema: z.object({
    name: z.string(),
    brand: reference('brands'),
    // The periods the line was on sale, so a retired and revived line has several.
    // A last period with no `to` is still running; no periods means the dates are not recorded.
    periods,
  }),
});

// A model is one named design within a line (e.g. Submariner Date). Files live at models/<brand>/<line>/<model>.yaml.
// Its references are the individual reference numbers, each a fixed configuration with its own on-sale periods,
// so successive generations of a model are successive references.
const models = defineCollection({
  loader: glob({ pattern: '*/*/*.yaml', base: './src/data/models' }),
  schema: z.object({
    name: z.string(),
    line: reference('lines'),
    // Other brands a special edition is made with, e.g. Hermès for Apple Watch Hermès.
    collaborators: z.array(reference('brands')).default([]),
    // Where this model's facts were taken from.
    sources,
    references: z
      .array(
        z.object({
          ref: z.string(),
          // The first period's `from` is the year the reference was released.
          periods,
          // The maker's list price in a given year, in its home currency where it publishes one.
          price: z.object({ amount: z.number().positive(), currency, year: z.number().int() }).optional(),
          caseSize: z.number().optional(),
          // The fields below use fixed vocabularies so references can be filtered and compared across brands.
          // Where a brand has its own name for an option (Jubilee, Slate), it goes in `name` for display only.

          // What this reference's case is made of; more than one means a mixed case (steel and gold), not a choice.
          metals: z.array(metal).default([]),
          // Finishes the case is sold in, as options under this reference.
          caseColors: z.array(z.object({ color, name: z.string().optional() })).default([]),
          // The maker's own model numbers, where one reference covers several (Apple: by connectivity and region).
          modelNumbers: z
            .array(
              z.object({
                number: z.string(),
                connectivity: z.enum(['gps', 'gps-cellular']).optional(),
                regions: z.string().optional(),
              }),
            )
            .default([]),
          bezel: z
            .object({
              material: metal.optional(),
              colors: z.array(color).default([]),
              style: z.enum(['smooth', 'fluted', 'dive', 'gmt', 'tachymeter', 'gem-set']).optional(),
            })
            .optional(),
          crystal: z.enum(['sapphire', 'acrylic', 'mineral']).optional(),
          // The calibre name: an identifier, not a category.
          movement: z.string().optional(),
          // Options offered under this one reference number. Some brands give each its own reference instead.
          dials: z.array(z.object({ color, name: z.string().optional() })).default([]),
          bracelets: z
            .array(
              z.object({
                type: z.enum(['bracelet', 'leather-strap', 'rubber-strap', 'fabric-strap']),
                name: z.string().optional(),
              }),
            )
            .default([]),
        }),
      )
      // Each reference gets a page at a URL built from `ref`, so two that slugify alike would collide.
      .refine((list) => new Set(list.map(({ ref }) => refSlug(ref))).size === list.length, {
        message: 'Two references in this model produce the same URL; make each `ref` distinct.',
      })
      .default([]),
  }),
});

export const collections = { groups, brands, lines, models };
