// Looks on Wikimedia Commons for freely licensed photos of each model that has no photo of its own, and lists them
// for review. It changes no data: pick a photo, check it shows the right watch, then add it with
// `npm run photos:add -- <model id> "File:<title>"`.
//
//   npm run photos:commons
//   npm run photos:commons -- --brand richard-mille
//
// Models with no candidate are listed with the brand's press kit (`pressKit` on the brand), the next place to ask.
// Candidates go to scripts/out/commons-photos.json as well as the console.
import { mkdirSync, writeFileSync } from 'node:fs';
import { freeLicense, headersFor, load } from './lib/data.mjs';

const args = process.argv.slice(2);
const brandOnly = args.includes('--brand') ? args[args.indexOf('--brand') + 1] : undefined;

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
      };
    })
    .filter((candidate) => freeLicense(candidate.license) && candidate.width >= 400);
}

const brands = new Map(load('brands').map((brand) => [brand.id, brand.data]));
const models = load('models').filter((model) => !model.data.photo && (!brandOnly || model.id.startsWith(`${brandOnly}/`)));

const found = {};
const none = [];
for (const model of models) {
  const brandId = model.id.split('/')[0];
  const brand = brands.get(brandId);
  // The model's name already starts with its number or line, so the brand's name is added in quotes to keep namesakes out.
  const list = await candidates(`"${brand.name}" ${model.data.name}`);
  if (list.length > 0) found[model.id] = list;
  else none.push({ model: model.id, pressKit: brand.pressKit });
  // Commons asks bots to go gently.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

mkdirSync('scripts/out', { recursive: true });
writeFileSync('scripts/out/commons-photos.json', JSON.stringify({ found, none }, null, 2) + '\n');

for (const [model, list] of Object.entries(found)) {
  console.log(`\n${model}`);
  for (const candidate of list) console.log(`  ${candidate.title} · ${candidate.license}${candidate.author ? ` · ${candidate.author}` : ''}\n    ${candidate.page}`);
}
console.log(`\n${Object.keys(found).length} of ${models.length} models have Commons candidates to review.`);
if (none.length > 0) {
  console.log(`\nNo Commons photo; try the brand's press kit:`);
  for (const { model, pressKit } of none) console.log(`  ${model} · ${pressKit ?? 'no press kit on record'}`);
}
