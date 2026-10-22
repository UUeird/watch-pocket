// Looks on Wikimedia Commons for freely licensed photos of each model, leaving out those it already has, and lists
// them for review. It changes no data: pick a photo, check it shows the right watch, then add it with
// `npm run photos:add -- <model id> "File:<title>"`.
//
//   npm run photos:commons
//   npm run photos:commons -- --brand richard-mille
//   npm run photos:commons -- --brand rolex --refs   # also searches each reference number
//
// Each candidate lists, as `refs`, the model's references its title, description or categories name, so it can go to
// that reference (`photos:add -- … --ref <ref>`) where the reference looks unlike the others.
// Models with no candidate are listed with the brand's press kit (`pressKit` on the brand), the next place to ask.
// Candidates go to scripts/out/commons-photos.json as well as the console.
import { mkdirSync, writeFileSync } from 'node:fs';
import { freeLicense, headersFor, load } from './lib/data.mjs';

const args = process.argv.slice(2);
const brandOnly = args.includes('--brand') ? args[args.indexOf('--brand') + 1] : undefined;
const byRef = args.includes('--refs');

const api = 'https://commons.wikimedia.org/w/api.php';

async function commons(params) {
  const url = `${api}?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })}`;
  const response = await fetch(url, { headers: headersFor(api) });
  if (!response.ok) throw new Error(`Commons returned ${response.status}`);
  return response.json();
}

const plain = (html = '') => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function candidates(query) {
  const result = await commons({
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '12',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '640',
  });
  return (result.query?.pages ?? [])
    .map((page) => {
      const info = page.imageinfo?.[0];
      const meta = info?.extmetadata ?? {};
      return {
        title: page.title,
        page: info?.descriptionurl,
        thumb: info?.thumburl,
        width: info?.width,
        height: info?.height,
        license: meta.LicenseShortName?.value,
        author: plain(meta.Artist?.value),
        description: plain(meta.ImageDescription?.value).slice(0, 200),
        categories: meta.Categories?.value,
        // Where the file names a reference, the uploader's text is kept whole, for the reference search below.
        text: `${page.title} ${plain(meta.ImageDescription?.value)} ${meta.Categories?.value ?? ''}`,
      };
    })
    .filter((candidate) => freeLicense(candidate.license) && candidate.width >= 400);
}

// The references whose number appears in `text` as a whole: ignoring case, and spaces or punctuation inside it
// (126710 BLRO), but not as part of a longer number (16610 in 116610LN). Numbers shorter than five characters, and
// names that are words rather than numbers (Apple's), match too loosely to count.
const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
const refsNamed = (text, refs) =>
  refs.filter((ref) => {
    const chars = squash(ref);
    if (!/\d{3}/.test(ref) || chars.length < 5) return false;
    return new RegExp(`(?<![a-z0-9])${[...chars].join('[^a-z0-9]?')}(?![0-9])`, 'i').test(text);
  });

const brands = new Map(load('brands').map((brand) => [brand.id, brand.data]));
const models = load('models').filter((model) => !brandOnly || model.id.startsWith(`${brandOnly}/`));

const found = {};
const none = [];
for (const model of models) {
  const brandId = model.id.split('/')[0];
  const brand = brands.get(brandId);
  // The model's name already starts with its number or line, so the brand's name is added in quotes to keep namesakes out.
  const have = new Set((model.data.photos ?? []).map((photo) => photo.credit?.source));
  const refs = (model.data.references ?? []).map(({ ref }) => String(ref));
  const queries = [`"${brand.name}" ${model.data.name}`, ...(byRef ? refs.filter((ref) => /\d{3}/.test(ref)).map((ref) => `"${brand.name}" "${ref}"`) : [])];
  const seen = new Set();
  const list = [];
  for (const query of queries) {
    for (const candidate of await candidates(query)) {
      if (have.has(candidate.page) || seen.has(candidate.title)) continue;
      seen.add(candidate.title);
      const { text, ...rest } = candidate;
      list.push({ ...rest, refs: refsNamed(text, refs) });
    }
    if (queries.length > 1) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (list.length > 0) found[model.id] = list;
  else if (have.size === 0) none.push({ model: model.id, pressKit: brand.pressKit });
  // Commons asks bots to go gently.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

mkdirSync('scripts/out', { recursive: true });
writeFileSync('scripts/out/commons-photos.json', JSON.stringify({ found, none }, null, 2) + '\n');

for (const [model, list] of Object.entries(found)) {
  console.log(`\n${model}`);
  for (const candidate of list) console.log(`  ${candidate.title} · ${candidate.license}${candidate.author ? ` · ${candidate.author}` : ''}${candidate.refs.length ? ` · names ${candidate.refs.join(', ')}` : ''}\n    ${candidate.page}`);
}
console.log(`\n${Object.keys(found).length} of ${models.length} models have Commons candidates to review.`);
if (none.length > 0) {
  console.log(`\nNo Commons photo; try the brand's press kit:`);
  for (const { model, pressKit } of none) console.log(`  ${model} · ${pressKit ?? 'no press kit on record'}`);
}
