// Builds the data for the photo review page from `npm run photos:commons` output: each model with its references and
// its Commons candidates, as small thumbnails inlined as data URIs (the page can't hold one file per photo). Photos
// already on the site come first, marked `onSite`, with the reference they belong to where they belong to one.
//
//   npm run photos:commons && npm run photos:review
//
// Writes scripts/out/photo-review.json, which the review page publishes as photos.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { headersFor, load } from './lib/data.mjs';

const { found, none } = JSON.parse(readFileSync('scripts/out/commons-photos.json', 'utf8'));
const models = new Map(load('models').map((model) => [model.id, model]));
const brands = new Map(load('brands').map((brand) => [brand.id, brand.data]));
const lines = new Map(load('lines').map((line) => [line.id, line.data]));

const thumbnail = async (input) =>
  'data:image/jpeg;base64,' + (await sharp(input).resize({ width: 360, height: 360, fit: 'inside' }).jpeg({ quality: 72 }).toBuffer()).toString('base64');

// A few words on what sets a reference apart, so photos can be matched to it on the page.
const summary = (reference) =>
  [
    reference.caseSize && `${reference.caseSize} mm`,
    reference.metals?.join(' and '),
    reference.bezel?.colors?.length && `${reference.bezel.colors.join('/')} bezel`,
    reference.dials?.length && `${reference.dials.map((dial) => dial.name ?? dial.color).join(', ')} dial`,
    reference.periods?.[0] && `${reference.periods[0].from}${reference.periods.at(-1).to ? `–${reference.periods.at(-1).to}` : '–'}`,
  ]
    .filter(Boolean)
    .join(' · ');

// One of our own photos, as a candidate already picked.
async function onSite(model, photo, ref) {
  const file = resolve(dirname(model.file), photo.file);
  const { width, height } = await sharp(file).metadata();
  const title = 'File:' + decodeURIComponent(photo.credit.source.split('/File:')[1] ?? photo.credit.source).replaceAll('_', ' ');
  return { title, page: photo.credit.source, license: photo.credit.license, author: photo.credit.author, description: '', width, height, onSite: true, ref, refs: ref ? [ref] : [], thumb: await thumbnail(file) };
}

const out = [];
// Every model with a candidate or a photo on the site, so photos already added can still be moved to a reference.
const hasPhotos = (model) => (model.data.photos ?? []).length > 0 || (model.data.references ?? []).some((reference) => (reference.photos ?? []).length > 0);
const ids = [...new Set([...Object.keys(found), ...[...models.values()].filter(hasPhotos).map((model) => model.id)])];
for (const id of ids) {
  const list = found[id] ?? [];
  const model = models.get(id);
  if (!model) continue;
  const references = model.data.references ?? [];
  const candidates = [];
  for (const photo of model.data.photos ?? []) candidates.push(await onSite(model, photo));
  for (const reference of references) for (const photo of reference.photos ?? []) candidates.push(await onSite(model, photo, String(reference.ref)));
  for (const candidate of list) {
    try {
      const response = await fetch(candidate.thumb, { headers: headersFor(candidate.thumb) });
      candidates.push({ ...candidate, thumb: await thumbnail(Buffer.from(await response.arrayBuffer())) });
    } catch (error) {
      console.error(`Skipped ${candidate.title}: ${error.message}`);
    }
    // Commons asks bots to go gently.
    await new Promise((done) => setTimeout(done, 150));
  }
  out.push({
    id,
    docId: id.replaceAll('/', '~'),
    name: model.data.name,
    brand: brands.get(id.split('/')[0]).name,
    line: lines.get(model.data.line)?.name,
    references: references.map((reference) => ({ ref: String(reference.ref), summary: summary(reference) })),
    candidates,
  });
}
const missing = none.map(({ model, pressKit }) => ({ id: model, name: models.get(model).data.name, brand: brands.get(model.split('/')[0]).name, pressKit }));
writeFileSync('scripts/out/photo-review.json', JSON.stringify({ models: out, missing }));
console.log(`${out.length} models, ${out.reduce((n, model) => n + model.candidates.length, 0)} photos; ${missing.length} models with none found.`);
