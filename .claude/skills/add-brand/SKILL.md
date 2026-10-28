---
name: add-brand
description: "Add a new watch brand to src/data/brands with every required fact researched and sourced: makes, owner or independent, origin, founding year, segment, website and logo. Use whenever a brand file is created, including a brand added so a new model, owner or collaborator has somewhere to point."
---

A new brand must carry five facts, or the build fails (`checkBrandFacts` in
`src/lib/consistency.ts`). Never add a new brand to `src/data/known-gaps.json`
to get past the build: that list is only for brands from before the rule, and
may only shrink. If a fact can't be sourced, stop and tell Sam which one and why.

Research each fact, then add every URL you relied on to the brand's `sources`
(ownership and heritage cite their own `sources` inside the record).

1. **Check for an existing brand.** Search `src/data/brands` for the name,
   former names and the parent company. Groups and brands can share an id
   (Chanel, Seiko Epson).
2. **Origin** (`origin`): the country where the brand was founded. `headquarters`
   and `manufacturing` are separate facts; fill them in when sources give them.
3. **Founding year** (`periods`): the brand's own site alone is enough; cite
   the exact page. Press or aggregators need two agreeing sources. A year of an
   older business the brand claims descent from goes in `heritage`, not
   `periods`. Revived brands get one period per trading run.
4. **Owner** (`ownership`, or `independent`): the brand's own About, history or
   imprint page is enough; cite it. Press must be clear and current (a current
   owner sourced before ~2018 is stale). The company that runs the website or
   holds the trademark isn't necessarily the owner. If the owner is a new group,
   add it to `src/data/groups`. For an unowned brand, set `independent` with a
   source, and `control` (public, family, private, foundation) where known.
5. **Makes**: everything the brand makes **or has made**: `mechanical-watches`,
   `quartz-watches`, `smartwatches`. `movements` and `cases` only if it supplied
   them to other brands; building your own calibres doesn't count. Check for
   past quartz lines (1970s–90s) and past smartwatches, not only the current
   catalog. Cite a page per kind (Wikipedia, the brand's collection pages, an
   authorized retailer or press).
6. **Segment**: set by the typical new list price of the brand's watches (the
   median of its current range, in USD), from its own shop or price list; cite
   that page. For a Shopify store, `<site>/collections/all` lists every price.
   - `budget`: under about $200
   - `mid-range`: about $200 to $3,000
   - `luxury`: above $3,000, and established luxury houses
   - `haute`: high horology (hand-finished, small-series complications)
   - `broad`: a range spanning three or more tiers (Seiko, Casio, Citizen)
   Count watches only, not straps, boxes or jewelry. For a defunct brand, use
   its tier while it traded, from press or auction records. Leave it blank if
   the brand's prices can't be found.
7. **Website**: the brand's current official site. Make sure it is the brand,
   not a namesake, parked domain or spam page.
8. **Logo**: from Wikimedia Commons (public domain, CC BY or CC BY-SA with
   `author` and `licenseUrl`). Check that the Commons file is this company, not
   a namesake. Cropping, trimming and resizing are fine; never alter the mark.
   Logos are displayed through `src/lib/logo.ts`.

Then run `npm run check` and `npm run build`, and open the brand's page in the
dev server to see the facts show up.
