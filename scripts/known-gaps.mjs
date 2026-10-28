// Writes src/data/known-gaps.json: for each brand from before the brand-facts rule, the facts it still lacks.
// The build fails on a brand missing a fact not listed here, and on a listed fact that has since been filled in.
// Rerun only to shrink the list after filling facts in bulk: `node scripts/known-gaps.mjs`. Never to add brands.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';

const dir = 'src/data/brands';
const out = 'src/data/known-gaps.json';
const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : undefined;
const has = {
  makes: (b) => (b.makes ?? []).length > 0,
  owner: (b) => (b.ownership ?? []).length > 0 || b.independent !== undefined || b.control !== undefined,
  origin: (b) => b.origin !== undefined,
  founded: (b) => (b.periods ?? []).length > 0,
  segment: (b) => b.segment !== undefined,
};
const gaps = {};
for (const file of readdirSync(dir).filter((name) => name.endsWith('.yaml')).sort()) {
  const id = file.replace(/\.yaml$/, '');
  const brand = parse(readFileSync(`${dir}/${file}`, 'utf8'));
  let missing = Object.keys(has).filter((fact) => !has[fact](brand));
  // Once the list exists it may only shrink: a brand or fact not already listed stays off it.
  if (previous) missing = missing.filter((fact) => (previous[id] ?? []).includes(fact));
  if (missing.length > 0) gaps[id] = missing;
}
writeFileSync(out, JSON.stringify(gaps, null, 1).replace(/\[\s+([^\]]*?)\s+\]/g, (_, inner) => `[${inner.replace(/\s+/g, ' ')}]`) + '\n');
const count = (fact) => Object.values(gaps).filter((list) => list.includes(fact)).length;
console.log(`${Object.keys(gaps).length} brands with gaps:`, Object.fromEntries(Object.keys(has).map((fact) => [fact, count(fact)])));
