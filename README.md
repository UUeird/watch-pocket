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
```

## Data

The site is built with [Astro](https://astro.build) from data files in the repo:

- `src/data/brands/` holds one YAML file per brand. Its optional `logo` is a path to an image file, relative to the brand's file (e.g. `../logos/rolex.svg`). `logoCredit` records where the file came from (`source`) and its `license`, plus `licenseUrl` and `author` where the license requires a credit; it is shown under the logo on the brand's page.
  An optional `logomark` (with `logomarkCredit`) is the symbol alone, without the wordmark, for spaces too small for the full logo. See `scripts/logo-sweep/README.md` for how logos are found and approved.
- `src/data/groups/` holds one YAML file per ownership group or corporation. It takes the same optional `logo`, `logomark` and credits as a brand.
- `src/data/lines/<brand>/` holds one file per product line.
- `src/data/models/<brand>/<line>/` holds one file per model, listing its references.

The schemas live in `src/content.config.ts` and are checked at build time, so bad data fails the build with a message. `npm run test:rules` confirms each rule still fires; stop the dev server first, since it breaks data files temporarily.

The browser tests need a one-time `npx playwright install chromium`.

Every pull request runs the type check, the build, the link check, the browser tests and the rule tests in GitHub Actions.

## Deployment

The site is published to GitHub Pages at https://www.watchpocket.app/ (the bare watchpocket.app redirects there). Once CI passes on `main`, the Deploy workflow (`.github/workflows/deploy.yml`) builds that commit and publishes it; it can also be run by hand from the Actions tab.

The custom domain is set in the repo's Pages settings, and DNS for watchpocket.app is at Porkbun: a `www` CNAME to `uueird.github.io`, and A/AAAA records on the apex pointing to GitHub's Pages addresses. `site` in `astro.config.mjs` holds the same address.

Every internal link is built with `href()` from `src/lib/catalog.ts`, which adds the `base` path from `astro.config.mjs` if one is set. There is none on the custom domain, but keeping links on `href()` means moving the site under a path again only needs the config changed.

Much of the data was entered from memory and is not yet verified. A fact that has been checked carries `sources`, a list of links: on each ownership and licensee record for that claim, and on the brand, group or model file for everything else.
