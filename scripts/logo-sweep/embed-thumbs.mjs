// Embeds each candidate's Commons thumbnail as a data URI, since the review page cannot load images from Commons.
// Usage: node embed-thumbs.mjs candidates.json review/candidates.json
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
const UA = { 'User-Agent': 'watch-pocket logo sweep/1.0 (sam@samelawrence.com)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const brands = JSON.parse(readFileSync(input, 'utf8'));
const jobs = brands.flatMap((brand) => brand.candidates);

async function thumb(candidate) {
  // The 320px rendering the API names; Commons refuses widths outside its standard set.
  const url = candidate.thumb ?? candidate.url;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) {
      const type = res.headers.get('content-type') ?? 'image/png';
      return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    }
    // A smaller size than the original is refused for small files; fall back to the original.
    if (res.status === 400 || res.status === 404) return thumbFrom(candidate.url);
    await sleep(1500 * (attempt + 1));
  }
}
async function thumbFrom(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return undefined;
  return `data:${res.headers.get('content-type')};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      job.thumbData = await thumb(job).catch(() => undefined);
      await sleep(100);
    }
  }),
);
for (const brand of brands) brand.candidates = brand.candidates.filter((c) => c.thumbData);
const kept = brands.filter((brand) => brand.candidates.length > 0);
writeFileSync(output, JSON.stringify(kept));
console.error(`${kept.length} brands, ${kept.reduce((n, b) => n + b.candidates.length, 0)} candidates, ${(Buffer.byteLength(JSON.stringify(kept)) / 1e6).toFixed(1)} MB`);
