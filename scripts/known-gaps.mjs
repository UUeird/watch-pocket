// Writes src/data/known-gaps.json: for each brand from before the brand-facts rule, the facts it still lacks, each
// with `null` (not yet researched) or the date it was last searched for and not found.
// The build fails on a brand missing a fact not listed here, and on a listed fact that has since been filled in.
// Rerun after filling facts in bulk, to drop the filled ones: `node scripts/known-gaps.mjs`. It never adds brands.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';

const dir = 'src/data/brands';
const out = 'src/data/known-gaps.json';
const previous = JSON.parse(readFileSync(out, 'utf8'));
export const has = {
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
  const kept = Object.entries(previous[id] ?? {}).filter(([fact]) => !has[fact](brand));
  if (kept.length > 0) gaps[id] = Object.fromEntries(kept);
}
writeJson(gaps);
const count = (fact) => Object.values(gaps).filter((facts) => fact in facts).length;
console.log(`${Object.keys(gaps).length} brands with gaps:`, Object.fromEntries(Object.keys(has).map((fact) => [fact, count(fact)])));

function writeJson(data) {
  const lines = Object.entries(data).map(([id, facts]) => `  ${JSON.stringify(id)}: ${JSON.stringify(facts).replace(/,"/g, ', "').replace(/":/g, '": ')}`);
  writeFileSync(out, `{\n${lines.join(',\n')}\n}\n`);
}
