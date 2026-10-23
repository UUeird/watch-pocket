# watch-pocket
A website to track the Watch makers of the world.

## Local development

Requires Node 24 (see `.nvmrc`).

```sh
npm install
npm run dev      # dev server at http://localhost:4321
npm run build    # static build into dist/
npm run preview  # serve the built site
npm run check    # type check
npm run test:links  # check internal links in the built site (run after a build)
npm run test:browser  # browser tests for the filters (run after a build)
npm run verify   # all of the above in turn: run it before merging a pull request
```

There is no CI: checks run locally before a pull request is merged, which is much faster. Run `npm run verify`, and `npm run test:rules` as well when the schema or its rules change.

## Data

The site is built with [Astro](https://astro.build) from data files in the repo:

- `src/data/brands/` holds one YAML file per brand. Its optional `logo` is a path to an image file, relative to the brand's file (e.g. `../logos/rolex.svg`). `logoCredit` records where the file came from (`source`) and its `license`, plus `licenseUrl` and `author` where the license requires a credit; it is shown under the logo on the brand's page. Where the logo combines a symbol and a name, `logomark` and `wordmark` can give each alone; charts show one of them in the logo's place where the whole logo would be too small to read. Crop each part at the logo's own scale (the same pixels per unit in its `width` and `height`), since a chart reads the wordmark's height as the height of the name within the logo. A part cropped from the logo's own file is covered by `logoCredit`; one from another file takes its own `logomarkCredit` or `wordmarkCredit`.
- `src/data/groups/` holds one YAML file per ownership group or corporation. It takes the same optional `logo`, `logomark`, `wordmark` and their credits as a brand.
- `src/data/lines/<brand>/` holds one file per product line.
- `src/data/models/<brand>/<line>/` holds one file per model, listing its references. `website` is the maker's own page for the model, linked from the model's page.

### Model photos

A model's page shows the best photo we may use, in this order:

1. **Our own copies** (`photos` on the model, each a `file` in `src/data/photos/` and its `credit`): from Wikimedia Commons under a free license (public domain, CC0, CC BY, CC BY-SA), or failing that from the brand's press kit for editorial use. The first is the primary, shown large; the others sit under it as thumbnails. A brand's `pressKit` records where to ask.

   A reference that looks unlike the model's others (another bezel, dial or metal) can have `photos` of its own, in the same form. Its page shows those, or else the model's, saying they show the model in general; the model's page shows its own photos and then its references', each labeled.
2. **The brand's own photo**, loaded from its site and credited to it, taken from the share preview on the model's `website` and recorded in `src/data/official-photos.json`. If it fails to load, the page shows the link alone.

```sh
npm run photos:commons -- --brand rolex   # list Commons candidates for models with no photo (changes nothing)
npm run photos:commons -- --refs          # also search each reference number; candidates list the references they name
npm run photos:review                     # build the photo review page's data from that list
npm run photos:add -- rolex/gmt-master-ii/gmt-master-ii "File:Rolex GMT Master II Pepsi.jpg"   # adds it last; --primary puts it first
npm run photos:add -- <model id> "File:<title>" --ref 126710BLRO   # adds it to that reference instead
npm run photos:add -- <model id> photo.jpg --source <url> --license "Press image, editorial use"
npm run photos:official                    # refresh the brands' own photos from each model's website
```

Check each Commons candidate shows the right watch before adding it: searches turn up namesakes and near misses.

### External links

`npm run check:external` checks every web address in the data and every brand photo the site loads, and lists those that are gone, moved, or couldn't be checked (sites that turn scripts away, such as rolex.com, show up there rather than as broken). `--host <domain>` limits it to one site. The External links workflow runs it each Monday and keeps one issue, labeled `external-links`, up to date with what needs fixing.

The schemas live in `src/content.config.ts` and are checked at build time, so bad data fails the build with a message. `npm run test:rules` confirms each rule still fires; stop the dev server first, since it breaks data files temporarily.

The browser tests need a one-time `npx playwright install chromium`.

Every pull request runs the type check, the build, the link check, the browser tests and the rule tests in GitHub Actions.

## Deployment

The site is published to GitHub Pages at https://www.watchpocket.app/ (the bare watchpocket.app redirects there). Each push to `main` runs the Deploy workflow (`.github/workflows/deploy.yml`), which builds that commit and publishes it; it can also be run by hand from the Actions tab. It also republishes `main` each Monday, refreshing the brands' own model photos first.

The custom domain is set in the repo's Pages settings, and DNS for watchpocket.app is at Porkbun: a `www` CNAME to `uueird.github.io`, and A/AAAA records on the apex pointing to GitHub's Pages addresses. `site` in `astro.config.mjs` holds the same address.

Every internal link is built with `href()` from `src/lib/catalog.ts`, which adds the `base` path from `astro.config.mjs` if one is set. There is none on the custom domain, but keeping links on `href()` means moving the site under a path again only needs the config changed.

Much of the data was entered from memory and is not yet verified. A fact that has been checked carries `sources`, a list of links: on each ownership and licensee record for that claim, and on the brand, group or model file for everything else.
