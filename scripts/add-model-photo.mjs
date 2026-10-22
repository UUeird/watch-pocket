// Adds a photo to a model: downloads it into src/data/photos/ and adds it, with its credit, to the model's `photos`.
// It goes last, or first with --primary, which makes it the photo the model's page shows large.
//
// From Wikimedia Commons, with the credit taken from the file's page:
//   npm run photos:add -- richard-mille/rm-67/rm-67-02 "File:Richard Mille RM 67-02.jpg"
//
// From a brand's press kit, with the page it came from and the terms it was given on:
//   npm run photos:add -- richard-mille/rm-67/rm-67-02 ~/Downloads/rm67-02.jpg --source https://… --license "Press image, editorial use"
//
// It refuses a Commons file whose license the site can't use, or one the model already has.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { freeLicense, headersFor } from './lib/data.mjs';

const [modelId, from, ...rest] = process.argv.slice(2);
const option = (name) => (rest.includes(`--${name}`) ? rest[rest.indexOf(`--${name}`) + 1] : undefined);
if (!modelId || !from) {
  console.error('Usage: npm run photos:add -- <model id> "File:<Commons title>" | <file> --source <url> --license <terms>');
  process.exit(1);
}

const modelFile = join('src/data/models', `${modelId}.yaml`);
let yaml;
try {
  yaml = readFileSync(modelFile, 'utf8');
} catch {
  console.error(`No model at ${modelFile}.`);
  process.exit(1);
}
const doc = parseDocument(yaml);
const existing = doc.get('photos')?.toJSON() ?? [];
const primary = rest.includes('--primary');

const quote = (text) => JSON.stringify(text);
let credit;
let saveTo;
const photosDir = join('src/data/photos', dirname(modelId));
mkdirSync(photosDir, { recursive: true });
// Each photo gets its own file: the model's name, then -2, -3 and so on.
const base = modelId.split('/').at(-1) + (existing.length > 0 ? `-${existing.length + 1}` : '');

if (from.startsWith('File:')) {
  const api = 'https://commons.wikimedia.org/w/api.php';
  const params = new URLSearchParams({ action: 'query', titles: from, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1600', format: 'json', formatversion: '2' });
  const result = await (await fetch(`${api}?${params}`, { headers: headersFor(api) })).json();
  const info = result.query?.pages?.[0]?.imageinfo?.[0];
  if (!info) {
    console.error(`No file called ${from} on Commons.`);
    process.exit(1);
  }
  const meta = info.extmetadata ?? {};
  const license = meta.LicenseShortName?.value ?? '';
  if (!freeLicense(license)) {
    console.error(`${from} is ${license || 'unlicensed'}, which the site can't use.`);
    process.exit(1);
  }
  // A 1600px-wide copy where the original is larger, which is plenty for the page.
  const download = info.thumburl ?? info.url;
  const response = await fetch(download, { headers: headersFor(download) });
  if (!response.ok) {
    console.error(`Couldn't download ${download}: ${response.status}`);
    process.exit(1);
  }
  saveTo = join(photosDir, `${base}${extname(new URL(download).pathname).toLowerCase() || '.jpg'}`);
  writeFileSync(saveTo, Buffer.from(await response.arrayBuffer()));
  const author = (meta.Artist?.value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  credit = { source: info.descriptionurl, license, licenseUrl: meta.LicenseUrl?.value, author: author || undefined };
} else {
  const source = option('source');
  const license = option('license');
  if (!source || !license) {
    console.error('A press-kit photo needs --source (where it came from) and --license (the terms it was given on).');
    process.exit(1);
  }
  saveTo = join(photosDir, `${base}${extname(from).toLowerCase()}`);
  copyFileSync(from, saveTo);
  credit = { source, license };
}

if (existing.some((photo) => photo.credit?.source === credit.source)) {
  console.error(`${modelId} already has the photo from ${credit.source}.`);
  rmSync(saveTo);
  process.exit(1);
}
const entry = { file: relative(dirname(modelFile), saveTo), credit: Object.fromEntries(Object.entries(credit).filter(([, value]) => value)) };
const photos = primary ? [entry, ...existing] : [...existing, entry];
// Only the photos block is rewritten, so the rest of the file keeps its formatting. It goes where it was, or after
// the model's website, or its line, ahead of its references.
const block = stringify({ photos }, { lineWidth: 0 }).trimEnd();
const lines = yaml.split('\n');
const at = lines.findIndex((line) => /^photos:/.test(line));
if (at !== -1) {
  let end = at + 1;
  while (end < lines.length && (lines[end].startsWith(' ') || lines[end] === '')) end++;
  lines.splice(at, end - at, block);
} else {
  const after = lines.findIndex((line) => /^website:/.test(line)) !== -1 ? lines.findIndex((line) => /^website:/.test(line)) : lines.findIndex((line) => /^line:/.test(line));
  lines.splice(after + 1, 0, block);
}
writeFileSync(modelFile, lines.join('\n'));
console.log(`Added ${saveTo} to ${modelFile} as photo ${primary ? 1 : photos.length} of ${photos.length} (${credit.license}). Check it shows ${modelId}, then build.`);
