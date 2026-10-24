// Adds a photo to a model: downloads it into src/data/photos/ and adds it, with its credit, to the model's `photos`.
// It goes last, or first with --primary. Photos belong to the reference they show wherever that can be told, so for a
// model with references it needs --ref <ref>, or --model for a photo that could be any of them; a file whose title
// names exactly one of the model's references goes to that one without being told.
//
// From Wikimedia Commons, with the credit taken from the file's page:
//   npm run photos:add -- richard-mille/rm-67/rm-67-02 "File:Richard Mille RM 67-02.jpg"
//   npm run photos:add -- rolex/gmt-master-ii/gmt-master-ii "File:Rolex GMT Master II Pepsi.jpg" --ref 126710BLRO
//
// From a brand's press kit, with the page it came from and the terms it was given on:
//   npm run photos:add -- richard-mille/rm-67/rm-67-02 ~/Downloads/rm67-02.jpg --source https://… --license "Press image, editorial use"
//
// It refuses a Commons file whose license the site can't use, or one the model already has.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { freeLicense, headersFor, refsNamed } from './lib/data.mjs';

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
const primary = rest.includes('--primary');
const refs = (doc.get('references')?.toJSON() ?? []).map((entry) => String(entry.ref));
let ref = option('ref');
if (ref === undefined && !rest.includes('--model') && refs.length > 0) {
  const named = from.startsWith('File:') ? refsNamed(from, refs) : [];
  if (named.length !== 1) {
    console.error(
      `${modelId} has references, so say what the photo shows: --ref <${refs.slice(0, 6).join(' | ')}${refs.length > 6 ? ' | …' : ''}>, ` +
        'or --model for a photo that could be any of them.',
    );
    process.exit(1);
  }
  ref = named[0];
  console.log(`The file's title names ${ref}, so it goes to that reference.`);
}
// The reference's place in the model's list, when the photo is for one.
const refIndex = ref === undefined ? -1 : (doc.get('references')?.toJSON() ?? []).findIndex((entry) => String(entry.ref) === ref);
if (ref !== undefined && refIndex === -1) {
  console.error(`${modelId} has no reference ${ref}.`);
  process.exit(1);
}
const existing = (ref === undefined ? doc.get('photos') : doc.getIn(['references', refIndex, 'photos']))?.toJSON() ?? [];

const quote = (text) => JSON.stringify(text);
let credit;
let saveTo;
const photosDir = join('src/data/photos', dirname(modelId));
mkdirSync(photosDir, { recursive: true });
// Each photo gets its own file: the model's name, then -2, -3 and so on.
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const base = modelId.split('/').at(-1) + (ref === undefined ? '' : `-${slug(ref)}`) + (existing.length > 0 ? `-${existing.length + 1}` : '');

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
const owner = ref === undefined ? modelId : `${modelId} ${ref}`;
if (ref !== undefined) {
  // The reference's photos block is rewritten as text, like the model's below, so the rest of the file keeps its
  // formatting. It sits right after the reference's `ref` line.
  const lines = yaml.split('\n');
  const starts = lines.flatMap((line, index) => (/^  - ref:/.test(line) ? [index] : []));
  const at = starts[refIndex];
  const block = stringify({ photos }, { lineWidth: 0 }).trimEnd().split('\n').map((line) => `    ${line}`);
  let from = at + 1;
  let to = from;
  if (/^    photos:/.test(lines[from] ?? '')) {
    to++;
    while (to < lines.length && lines[to].startsWith('      ')) to++;
  }
  lines.splice(from, to - from, ...block);
  writeFileSync(modelFile, lines.join('\n'));
  console.log(`Added ${saveTo} to ${owner} in ${modelFile} as photo ${primary ? 1 : photos.length} of ${photos.length} (${credit.license}). Check it shows ${owner}, then build.`);
  process.exit(0);
}
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
