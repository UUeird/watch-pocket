// Reads the site's data files directly, without Astro, for the scripts that check and update them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';

export const dataDir = 'src/data';
export const officialPhotosFile = join(dataDir, 'official-photos.json');

const yamlFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return yamlFiles(path);
    return name.endsWith('.yaml') ? [path] : [];
  });

// Every record in one collection, with its id as Astro gives it: the file's path within the collection, without `.yaml`.
export function load(collection) {
  const base = join(dataDir, collection);
  return yamlFiles(base).map((file) => ({
    collection,
    id: relative(base, file).replace(/\.yaml$/, ''),
    file,
    data: parse(readFileSync(file, 'utf8')) ?? {},
  }));
}

export const loadAll = () => ['groups', 'brands', 'lines', 'models'].flatMap(load);

// Every web address in a record, with where it sits, e.g. `revenue[0].sources[1]`.
export function urlsIn(value, path = '') {
  if (typeof value === 'string') return /^https?:\/\//.test(value) ? [{ url: value, path }] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => urlsIn(item, `${path}[${index}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => urlsIn(item, path ? `${path}.${key}` : key));
  return [];
}

export function readOfficialPhotos() {
  try {
    return JSON.parse(readFileSync(officialPhotosFile, 'utf8'));
  } catch {
    return {};
  }
}

// Licenses the site can use for a photo or logo: public domain, CC0, CC BY and CC BY-SA. Not NC, ND or fair use.
export const freeLicense = (name = '') => /^(public domain|pd\b|cc0|cc[ -]by(-sa)?[ -]\d)/i.test(name.trim()) && !/\b(nc|nd)\b/i.test(name);

// Brand sites often turn away requests that don't look like a browser. Wikimedia asks instead for a name and contact.
const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const named = 'WatchPocketBot/1.0 (https://www.watchpocket.app; link checks)';
export const userAgentFor = (url) => (/(^|\.)(wikimedia|wikipedia|wikidata)\.org$/.test(new URL(url).hostname) ? named : browser);

export const headersFor = (url) => ({
  'user-agent': userAgentFor(url),
  accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/*,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
});

// Runs `task` over `items`, at most `limit` at once and at most `perHost` at once against any one site.
export async function eachPolitely(items, task, { limit = 12, perHost = 2, hostOf = (item) => new URL(item.url ?? item).hostname } = {}) {
  const running = new Map();
  const queue = [...items];
  let active = 0;
  await new Promise((resolve) => {
    const next = () => {
      if (queue.length === 0 && active === 0) return resolve();
      while (active < limit) {
        const index = queue.findIndex((item) => (running.get(hostOf(item)) ?? 0) < perHost);
        if (index === -1) break;
        const [item] = queue.splice(index, 1);
        const host = hostOf(item);
        running.set(host, (running.get(host) ?? 0) + 1);
        active++;
        task(item)
          .catch(() => {})
          .finally(() => {
            running.set(host, running.get(host) - 1);
            active--;
            next();
          });
      }
    };
    next();
  });
}

// The references whose number appears in `text` as a whole: ignoring case, and spaces or punctuation inside it
// (126710 BLRO), but not as part of a longer number (16610 in 116610LN). Numbers shorter than five characters, and
// names that are words rather than numbers (Apple's), match too loosely to count.
const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
export const refsNamed = (text, refs) =>
  refs.filter((ref) => {
    const chars = squash(ref);
    if (!/\d{3}/.test(ref) || chars.length < 5) return false;
    return new RegExp(`(?<![a-z0-9])${[...chars].join('[^a-z0-9]?')}(?![0-9])`, 'i').test(text);
  });
