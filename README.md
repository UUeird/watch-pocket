# watch-pocket
A website to track the Watch makers of the world.

## Local development

Requires Node 24 (see `.nvmrc`).

```sh
npm install
npm run dev      # dev server at http://localhost:4321
npm run build    # static build into dist/
npm run preview  # serve the built site
```

## Data

The site is built with [Astro](https://astro.build) from data files in the repo:

- `src/data/brands/` holds one YAML file per brand.
- `src/data/groups/` holds one YAML file per ownership group or corporation.
- `src/data/lines/<brand>/` holds one file per product line.
- `src/data/models/<brand>/<line>/` holds one file per model, listing its references.

The schemas live in `src/content.config.ts` and are checked at build time, so bad data fails the build with a message. `npm run test:rules` confirms each rule still fires; stop the dev server first, since it breaks data files temporarily.

Much of the data was entered from memory and is not yet verified.
