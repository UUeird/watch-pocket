// What to research next, from src/data/known-gaps.json, highest-priority brands first.
//   node scripts/research-queue.mjs [fact]                       list the queue, optionally for one fact
//   node scripts/research-queue.mjs --searched <fact> <id>...    record that a search found nothing today
//   node scripts/research-queue.mjs --summary                    progress per fact and tier
// A fact searched and not found is left out of the queue for a year, unless the brand has since moved up a tier.
// Tiers follow `brandTier` in src/lib/consistency.ts; keep the two in step.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';

const gapsFile = 'src/data/known-gaps.json';
const gaps = JSON.parse(readFileSync(gapsFile, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const brandsWithLines = new Set(existsSync('src/data/lines') ? readdirSync('src/data/lines') : []);
const read = (id) => parse(readFileSync(`src/data/brands/${id}.yaml`, 'utf8'));
const tier = (id, b) => {
  if (b.priority) return b.priority;
  if (brandsWithLines.has(id) || (b.revenue ?? []).length > 0 || b.production) return 'core';
  const owned = (b.ownership ?? []).some((record) => record.to === undefined);
  const highEnd = b.segment === 'luxury' || b.segment === 'haute';
  return JSON.stringify(b).includes('wikipedia.org/') || owned || highEnd ? 'notable' : 'long-tail';
};
const order = { core: 0, notable: 1, 'long-tail': 2 };

const args = process.argv.slice(2);
if (args[0] === '--summary') {
  // Per fact and tier: how many brands have it, were searched without finding it, or haven't been researched.
  const facts = ['makes', 'owner', 'origin', 'founded', 'segment'];
  const tiers = ['core', 'notable', 'long-tail'];
  const counts = {};
  for (const file of readdirSync('src/data/brands').filter((name) => name.endsWith('.yaml'))) {
    const id = file.slice(0, -5);
    const t = tier(id, read(id));
    for (const fact of facts) {
      const state = !gaps[id] || !(fact in gaps[id]) ? 'filled' : gaps[id][fact] ? 'searched' : 'todo';
      const key = `${fact}|${t}`;
      counts[key] ??= { filled: 0, searched: 0, todo: 0 };
      counts[key][state]++;
    }
  }
  const rows = [['fact', 'tier', 'filled', 'searched, not found', 'not researched', 'done']];
  for (const fact of facts) for (const t of tiers) {
    const c = counts[`${fact}|${t}`] ?? { filled: 0, searched: 0, todo: 0 };
    const total = c.filled + c.searched + c.todo;
    rows.push([fact, t, c.filled, c.searched, c.todo, total ? `${Math.round(((c.filled + c.searched) / total) * 100)}%` : '-']);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => String(row[i]).length)));
  for (const row of rows) console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join('  '));
  console.log('\n"done" counts a fact as handled once it is filled or searched without finding it.');
} else if (args[0] === '--searched') {
  const [, fact, ...ids] = args;
  for (const id of ids) {
    if (!gaps[id] || !(fact in gaps[id])) throw new Error(`"${id}" has no ${fact} gap to record.`);
    gaps[id][fact] = today;
  }
  const lines = Object.entries(gaps).map(([id, facts]) => `  ${JSON.stringify(id)}: ${JSON.stringify(facts).replace(/,"/g, ', "').replace(/":/g, '": ')}`);
  writeFileSync(gapsFile, `{\n${lines.join(',\n')}\n}\n`);
  console.log(`Recorded ${ids.length} ${fact} search${ids.length === 1 ? '' : 'es'} as not found on ${today}.`);
} else {
  const only = args[0];
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const queue = [];
  for (const [id, facts] of Object.entries(gaps)) {
    const b = read(id);
    const t = tier(id, b);
    for (const [fact, searched] of Object.entries(facts)) {
      if (only && fact !== only) continue;
      // Long-tail misses wait a year; notable and core brands are always worth another look.
      if (searched && t === 'long-tail' && searched > yearAgo) continue;
      queue.push({ tier: t, fact, id, searched, website: b.website ?? '' });
    }
  }
  queue.sort((a, b) => order[a.tier] - order[b.tier] || Number(Boolean(a.searched)) - Number(Boolean(b.searched)) || a.id.localeCompare(b.id));
  for (const row of queue) console.log([row.tier, row.fact, row.id, row.searched ?? '-', row.website].join('\t'));
  console.error(`${queue.length} to research`);
}
