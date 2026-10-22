// Finds the brand's own photo of each model on its official page (`website`), for models with no photo of our own,
// and records it in src/data/official-photos.json. The site then shows it, loaded from the brand's site and
// credited to them, until a licensed photo replaces it.
//
//   npm run photos:official
//
// A photo is taken from the page's share preview (og:image or twitter:image) and kept only if it loads as an image.
// Where a page can't be read today, the photo found before is kept if it still loads; otherwise it's dropped, and
// the page falls back to the link alone.
import { writeFileSync } from 'node:fs';
import { eachPolitely, headersFor, load, officialPhotosFile, readOfficialPhotos } from './lib/data.mjs';

const today = new Date().toISOString().slice(0, 10);
const previous = readOfficialPhotos();
const models = load('models').filter((model) => model.data.website && !model.data.photo);

const decode = (text) => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
// The share image a page names in its head, in either attribute order.
function shareImage(html, page) {
  for (const key of ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image']) {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
      'i',
    );
    const match = html.match(pattern);
    if (match) return new URL(decode(match[1] ?? match[2]), page).href;
  }
  return undefined;
}

const loadsAsImage = async (src) => {
  try {
    const response = await fetch(src, { headers: headersFor(src), signal: AbortSignal.timeout(25_000) });
    response.body?.cancel().catch(() => {});
    return response.ok && (response.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  }
};

const next = {};
const notes = [];
await eachPolitely(
  models,
  async (model) => {
    const page = model.data.website;
    let found;
    try {
      const response = await fetch(page, { headers: headersFor(page), signal: AbortSignal.timeout(25_000) });
      if (response.ok) found = shareImage(await response.text(), response.url);
      else notes.push(`${model.id}: page returned ${response.status}`);
    } catch (error) {
      notes.push(`${model.id}: page couldn't be read (${error.cause?.code ?? error.name})`);
    }
    if (found && (await loadsAsImage(found))) {
      next[model.id] = { src: found, page, checked: today };
      return;
    }
    if (found) notes.push(`${model.id}: share image doesn't load (${found})`);
    else if (!notes.some((note) => note.startsWith(`${model.id}:`))) notes.push(`${model.id}: page names no share image`);
    const old = previous[model.id];
    if (old && old.page === page && (await loadsAsImage(old.src))) next[model.id] = old;
  },
  { hostOf: (model) => new URL(model.data.website).hostname },
);

const sorted = Object.fromEntries(Object.keys(next).sort().map((id) => [id, next[id]]));
writeFileSync(officialPhotosFile, JSON.stringify(sorted, null, 2) + '\n');

const added = Object.keys(next).filter((id) => !previous[id]);
const changed = Object.keys(next).filter((id) => previous[id] && previous[id].src !== next[id].src);
const dropped = Object.keys(previous).filter((id) => !next[id]);
console.log(`${models.length} models with an official page and no photo of our own: ${Object.keys(next).length} have the brand's photo.`);
if (added.length) console.log(`Added: ${added.join(', ')}`);
if (changed.length) console.log(`Changed: ${changed.join(', ')}`);
if (dropped.length) console.log(`Dropped: ${dropped.join(', ')}`);
if (notes.length) console.log(`\nWithout a photo:\n${notes.map((note) => `- ${note}`).join('\n')}`);
