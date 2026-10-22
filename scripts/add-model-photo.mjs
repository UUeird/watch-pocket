// Adds a photo to a model: downloads it into src/data/photos/ and writes `photo` and `photoCredit` into the model's file.
//
// From Wikimedia Commons, with the credit taken from the file's page:
//   npm run photos:add -- richard-mille/rm-67/rm-67-02 "File:Richard Mille RM 67-02.jpg"
//
// From a brand's press kit, with the page it came from and the terms it was given on:
//   npm run photos:add -- richard-mille/rm-67/rm-67-02 ~/Downloads/rm67-02.jpg --source https://… --license "Press image, editorial use"
//
// It refuses a Commons file whose license the site can't use, and won't replace a model's existing photo.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
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
if (/^photo:/m.test(yaml)) {
  console.error(`${modelId} already has a photo. Remove its photo and photoCredit first to replace it.`);
  process.exit(1);
}

const quote = (text) => JSON.stringify(text);
let credit;
let saveTo;
const photosDir = join('src/data/photos', dirname(modelId));
mkdirSync(photosDir, { recursive: true });
const base = modelId.split('/').at(-1);

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

const lines = [
  `photo: ${relative(dirname(modelFile), saveTo)}`,
  'photoCredit:',
  ...Object.entries(credit)
    .filter(([, value]) => value)
    .map(([key, value]) => `  ${key}: ${quote(value)}`),
];
// Placed after the model's website, or its line, ahead of its references.
const after = /^website:.*$/m.test(yaml) ? /^website:.*$/m : /^line:.*$/m;
yaml = yaml.replace(after, (line) => `${line}\n${lines.join('\n')}`);
writeFileSync(modelFile, yaml);
console.log(`Added ${saveTo} to ${modelFile} (${credit.license}). Check the photo shows ${modelId}, then build.`);
