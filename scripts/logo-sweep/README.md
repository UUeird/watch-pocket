# Logo sweep

How brand logos and logomarks are found on Wikimedia Commons, reviewed by hand, and added to the site.

## The review page

Candidates are reviewed on a private claude.ai artifact:

**https://claude.ai/artifact/CEFiQvvatNQgVue29rh9f4** (Watch Pocket Logo Review, owned by Sam)

It lists, per brand, candidate files from Commons with their license, source, a confidence score and the
reason for it. Each candidate can be marked as the brand's **Logo** (the full mark as the brand shows it),
its **Logomark** (the symbol alone), or a logo to **Crop a logomark from**, or it can be **Rejected**. A brand
can also be marked **None of these**, or **I don't know**, which asks Claude to research it further.

The page has two sections: brands with no logo (the logo sweep), and brands that already have a logo and want
a logomark (the logomark sweep, which offers each brand's current logo as a candidate to crop from).

### Where the choices are kept

Choices save as they are made, in the artifact's database, collection `decisions`, one document per brand,
keyed by brand id (the YAML file name). A document holds any of:

| Field | Meaning |
|---|---|
| `logo` | Commons file title (`File:…`) to use as the brand's full logo |
| `logomark` | File title to use as its logomark, or `Current logo (<file>)` for the logo it already has |
| `cropMarkFrom` | File title of a logo to crop the logomark out of |
| `rejected` | List of file titles rejected for this brand |
| `skipped` | `true`: none of the candidates is right |
| `unsure` | `true`: Claude should research this brand |
| `choice` | Early format, before logomarks: a file title used as the logo, or `null` for skipped |

Claude reads them with the `ArtifactData` tool (`action: "list"`, `collection: "decisions"`, the URL above).
Research notes for `unsure` brands are written into the page's data, as a `research` field on the brand in
`candidates.json`, and shown under the brand's name.

## Rules for logo files

- Only public domain, CC0, CC BY or CC BY-SA. CC BY and CC BY-SA need `author` and `licenseUrl` in the credit.
- Trimming empty margins, resizing, fixing an SVG's viewBox, and cropping a symbol out of its own lockup are
  fine. Recoloring or redrawing a mark is not.
- Each file's origin goes in `logoCredit` or `logomarkCredit` (`source` is the Commons file page).

## The scripts

They run outside the repo build and only read the brand files.

- `find-logos.mjs <brands dir> <out.json>`: for brands with no logo, finds the brand's Wikidata item (from a
  cited Wikidata or Wikipedia link, else a name search limited to watch, jewelry and fashion descriptions),
  takes its logo property (P154), and searches Commons for files named for the brand plus generic words only.
  Keeps freely licensed images.
- `find-marks.mjs <brands dir> <out.json>`: the same for brands that have a logo, also taking Wikidata's
  "small logo or icon" (P8972) and searching for symbol, emblem and logomark files.
- `embed-thumbs.mjs <in.json> <out.json>`: fetches each candidate's 320px Commons thumbnail. Commons refuses
  thumbnail widths outside its standard set, so use the width the API returns.
- `score.py <repo> <review data> <marks.json> <review dir>`: scores each candidate's confidence (Wikidata-backed
  and named for the brand is high; found only by a common-word file name, or looking like a photograph, is
  low) and merges both sweeps into the review page's `candidates.json`.
- `review.html`: the review page itself. It is published with `candidates.json` and a `thumbs/` folder of
  thumbnails beside it, and declares the `db` capability for the choices.

Publishing limits met along the way: at most 255 files per publish and 511 per version, so small thumbnails
are inlined into `candidates.json` as data URIs; SVG files with a DOCTYPE declaration are refused, so the
review copies have it removed (the site's own files keep theirs).
