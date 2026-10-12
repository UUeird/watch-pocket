import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { countryNames } from './lib/countries';
import { refSlug } from './lib/slug';

const groups = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/data/groups' }),
  schema: z.object({
    name: z.string(),
    country: z.string(),
    type: z.enum(['luxury-group', 'holding-company', 'independent-company', 'private-equity']),
    founded: z.number().int().optional(),
    website: z.url().optional(),
    parent: reference('groups').optional(),
  }),
});

const color = z.enum([
  'black', 'white', 'silver', 'gray', 'blue', 'green', 'red', 'yellow', 'orange', 'brown', 'pink', 'purple', 'gold', 'rose-gold', 'champagne',
]);
const metal = z.enum(['steel', 'aluminum', 'yellow-gold', 'white-gold', 'rose-gold', 'platinum', 'titanium', 'ceramic', 'bronze']);

const country = z.enum(countryNames);

const endsAfterStart = ({ from, to }: { from?: number; to?: number }) =>
  from === undefined || to === undefined || to >= from;

// A list of year ranges, oldest first. Only the last may be open-ended, and none may overlap.
const periods = z
  .array(
    z
      .object({ from: z.number().int(), to: z.number().int().optional() })
      .refine(endsAfterStart, { message: 'A period cannot end before it starts.' }),
  )
  .refine((list) => list.every((entry, index) => index === 0 || list[index - 1].to !== undefined), {
    message: 'Only the last period may be open-ended; earlier ones need a `to` year.',
  })
  .refine((list) => list.every((entry, index) => index === 0 || entry.from >= (list[index - 1].to ?? entry.from)), {
    message: 'Periods must be in date order and must not overlap.',
  })
  .default([]);

// One holder's tenure (an owner or a licensee). The record with no `to` is the current one, so there can be only one.
const tenures = <Key extends string>(key: Key, target: 'groups') =>
  z
    .array(
      z
        .object({ from: z.number().int().optional(), to: z.number().int().optional() })
        .extend({ [key]: reference(target) } as Record<Key, ReturnType<typeof reference>>)
        .refine(endsAfterStart, { message: 'A record cannot end before it starts.' }),
    )
    .refine((list) => list.filter((record) => record.to === undefined).length <= 1, {
      message: `Only one ${key} can be current; give the earlier records a \`to\` year.`,
    })
    .default([]);

const brands = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/data/brands' }),
  schema: z
    .object({
      name: z.string(),
      // Three separate facts: where the brand was founded, where it is run from today, and where its watches are made.
      origin: country.optional(),
      headquarters: country.optional(),
      manufacturing: z.array(country).default([]),
      // The periods the brand traded, so a revived brand has several. A last period with no `to` is still running.
      periods,
      // Only for brands with no periods recorded; otherwise status is derived from them.
      status: z.enum(['active', 'dormant', 'defunct', 'revived']).optional(),
      // Market positioning. `broad` is for brands whose range spans several tiers.
      segment: z.enum(['haute', 'luxury', 'mid-range', 'budget', 'broad']).optional(),
      category: z.enum(['watch-brand', 'movement-maker']).default('watch-brand'),
      // What kind of business it is, where that is not simply a watch brand. A brand can carry several.
      tags: z.array(z.enum(['fashion', 'direct-to-consumer', 'smartwatch', 'early-digital'])).default([]),
      // Ownership is dated because brands change hands; the record with no `to` is the current owner.
      ownership: tenures('owner', 'groups'),
      // Companies that make and sell the brand's watches under license without owning the brand. Dated like ownership.
      licensees: tenures('licensee', 'groups'),
      // Confirmed to have no parent group. With no ownership records and this unset, the owner is not yet recorded.
      independent: z.boolean().default(false),
    })
    .refine((brand) => brand.periods.length === 0 || brand.status === undefined, {
      message: 'Set either `periods` or `status`, not both: status is derived from periods.',
    })
    .refine((brand) => !brand.independent || brand.ownership.every((record) => record.to !== undefined), {
      message: 'A brand cannot be `independent` and have a current owner.',
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
    sources: z.array(z.url()).default([]),
    references: z
      .array(
        z.object({
          ref: z.string(),
          periods,
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
