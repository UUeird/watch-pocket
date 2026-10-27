// Looks for freely licensed logos on Wikimedia Commons for brands that have none.
// Usage: node find-logos.mjs <brands dir> <out.json>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [brandsDir, out] = process.argv.slice(2);
const UA = { 'User-Agent': 'watch-pocket logo sweep/1.0 (sam@samelawrence.com)' };
// Brands to leave out, by id, e.g. ones another branch is already adding a logo for.
const skip = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries({ format: 'json', ...params })) u.searchParams.set(k, v);
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(u, { headers: UA });
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    return res.json();
  }
  throw new Error(`failed ${u}`);
}

const field = (text, key) => text.match(new RegExp(`^${key}: (.+)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
const brands = readdirSync(brandsDir)
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => {
    const text = readFileSync(join(brandsDir, f), 'utf8');
    return {
      id: f.replace(/\.yaml$/, ''),
      name: field(text, 'name'),
      origin: field(text, 'origin'),
      hasLogo: /^logo:/m.test(text),
      qid: text.match(/wikidata\.org\/wiki\/(Q\d+)/)?.[1],
      wikipedia: text.match(/https:\/\/(\w+)\.wikipedia\.org\/wiki\/([^\s'"]+)/),
    };
  })
  .filter((b) => !b.hasLogo && !skip.has(b.id));
console.error(`${brands.length} brands without a logo`);

// Descriptions that suggest the Wikidata item is the watch company, not a namesake.
const relevant = /watch|horolog|clock|timepiece|chronomet|jewel|luxury|fashion|couture|smartwatch|wearable|maison/i;
const generic = new Set(
  'file logo logos logotype wordmark svg png jpg jpeg gif webp watch watches watchmaker watchmakers uhren uhrenfabrik montres horlogerie orologi relojes company co corp corporation inc ltd limited sa ag gmbh srl spa bv nv plc group the and of de new old current official brand black white color colour colored blue red gold vector text small large transparent full horizontal vertical'.split(' '),
);
const words = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1);

async function findQid(brand) {
  if (brand.qid) return { qid: brand.qid, how: 'source' };
  if (brand.wikipedia) {
    const [, lang, title] = brand.wikipedia;
    const r = await get(`https://${lang}.wikipedia.org/w/api.php`, { action: 'query', prop: 'pageprops', titles: decodeURIComponent(title), redirects: 1 });
    const page = Object.values(r.query?.pages ?? {})[0];
    if (page?.pageprops?.wikibase_item) return { qid: page.pageprops.wikibase_item, how: 'wikipedia source' };
  }
  const r = await get('https://www.wikidata.org/w/api.php', { action: 'wbsearchentities', search: brand.name, language: 'en', limit: 10 });
  const hit = (r.search ?? []).find((s) => relevant.test(s.description ?? ''));
  return hit ? { qid: hit.id, how: 'name search', description: hit.description, label: hit.label } : undefined;
}

// A licence a logo may be used under here: public domain, CC0, CC BY or CC BY-SA. Not NC or ND.
const usable = (licence) => /^(public domain|pd|cc0)/i.test(licence) || (/^cc[ -]by(-sa)?[ -]\d/i.test(licence) && !/nc|nd/i.test(licence));

async function fileInfo(titles) {
  if (titles.length === 0) return [];
  const r = await get('https://commons.wikimedia.org/w/api.php', {
    action: 'query',
    titles: titles.map((t) => (t.startsWith('File:') ? t : `File:${t}`)).join('|'),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: 320,
  });
  return Object.values(r.query?.pages ?? {}).flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info) return [];
    const m = info.extmetadata ?? {};
    const value = (k) => (m[k]?.value ?? '').replace(/<[^>]+>/g, '').trim();
    return [
      {
        title: page.title,
        page: info.descriptionurl,
        url: info.url,
        thumb: info.thumburl,
        width: info.width,
        height: info.height,
        mime: info.mime,
        licence: value('LicenseShortName'),
        licenceUrl: value('LicenseUrl') || undefined,
        author: value('Artist') || undefined,
        description: value('ImageDescription').slice(0, 200) || undefined,
      },
    ];
  });
}

const results = [];
async function sweep(brand) {
  const found = await findQid(brand).catch(() => undefined);
  const titles = new Map();
  if (found) {
    const r = await get('https://www.wikidata.org/w/api.php', { action: 'wbgetentities', ids: found.qid, props: 'claims|labels|descriptions', languages: 'en' });
    const entity = r.entities?.[found.qid];
    found.label ??= entity?.labels?.en?.value;
    found.description ??= entity?.descriptions?.en?.value;
    for (const claim of entity?.claims?.P154 ?? []) {
      const file = claim.mainsnak?.datavalue?.value;
      if (file) titles.set(`File:${file}`, 'Wikidata logo');
    }
  }
  // Commons search, kept only where the file's name carries the brand's name and the word "logo".
  const r = await get('https://commons.wikimedia.org/w/api.php', { action: 'query', list: 'search', srnamespace: 6, srsearch: `${brand.name} logo`, srlimit: 10 });
  const nameWords = words(brand.name);
  for (const hit of r.query?.search ?? []) {
    const titleWords = words(hit.title);
    if (!titleWords.includes('logo') && !titleWords.includes('logotype') && !titleWords.includes('wordmark')) continue;
    if (!nameWords.every((w) => titleWords.includes(w))) continue;
    // Anything else in the file's name must be generic, so "Rot-Weiss Essen logo" is not taken for Weiss.
    const extra = titleWords.filter((w) => !nameWords.includes(w) && !generic.has(w) && !/^\d+$/.test(w));
    if (extra.length > 0) continue;
    if (!titles.has(hit.title)) titles.set(hit.title, 'Commons search');
  }
  const infos = await fileInfo([...titles.keys()].slice(0, 6));
  const candidates = infos
    .filter((info) => /^image\/(svg\+xml|png|jpeg|gif|webp)$/.test(info.mime))
    .map((info) => ({ ...info, via: titles.get(info.title) ?? 'Commons search', usable: usable(info.licence) }))
    .sort((a, b) => Number(b.via === 'Wikidata logo') - Number(a.via === 'Wikidata logo') || Number(b.mime === 'image/svg+xml') - Number(a.mime === 'image/svg+xml'));
  if (candidates.some((c) => c.usable)) {
    results.push({
      id: brand.id,
      name: brand.name,
      origin: brand.origin,
      wikidata: found && { ...found },
      candidates: candidates.filter((c) => c.usable).slice(0, 4),
      rejected: candidates.filter((c) => !c.usable).map((c) => ({ title: c.title, licence: c.licence })),
    });
  }
}

// A few at a time, to be gentle with the APIs.
let next = 0;
let done = 0;
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (next < brands.length) {
      const brand = brands[next++];
      try {
        await sweep(brand);
      } catch (error) {
        console.error(`${brand.id}: ${error.message}`);
      }
      await sleep(150);
      if (++done % 50 === 0) console.error(`${done}/${brands.length}, ${results.length} with candidates`);
    }
  }),
);
results.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(out, JSON.stringify(results, null, 2));
console.error(`done: ${results.length} brands with usable candidates`);
