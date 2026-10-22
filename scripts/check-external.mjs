// Checks every web address in the data files, and the brand photos the site loads from brand sites, and reports
// which are gone, which have moved and which couldn't be checked.
//
//   npm run check:external                      everything
//   npm run check:external -- --host richardmille.com
//   npm run check:external -- --report report.md
//
// Exits with an error when a link is gone (404, 410, or the site no longer exists), so a scheduled run can flag it.
// Sites that turn away scripts (403, 429, timeouts) are listed as unchecked, not broken.
import { writeFileSync } from 'node:fs';
import { eachPolitely, headersFor, loadAll, readOfficialPhotos, urlsIn } from './lib/data.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const onlyHost = option('host');
const reportPath = option('report');

// Each address, with every place it's used.
const uses = new Map();
const add = (url, where) => {
  if (!uses.has(url)) uses.set(url, []);
  uses.get(url).push(where);
};
for (const record of loadAll()) {
  for (const { url, path } of urlsIn(record.data)) add(url, `${record.file} (${path})`);
}
for (const [model, photo] of Object.entries(readOfficialPhotos())) add(photo.src, `src/data/official-photos.json (${model})`);

const urls = [...uses.keys()].filter((url) => !onlyHost || new URL(url).hostname.endsWith(onlyHost));
console.error(`Checking ${urls.length} addresses…`);

const timeout = 25_000;
// The same page, give or take a trailing slash, a www, http or a language prefix such as /en-us/.
const samePage = (from, to) => {
  const a = new URL(from);
  const b = new URL(to);
  const host = (url) => url.hostname.replace(/^www\./, '');
  const path = (url) => decodeURIComponent(url.pathname).replace(/\/$/, '').toLowerCase();
  return host(a) === host(b) && (path(a) === path(b) || path(b).endsWith(path(a)));
};
const isRoot = (url) => new URL(url).pathname.replace(/\/[a-z]{2}(-[a-z]{2})?\/?$/i, '/') === '/';

async function check(url) {
  let current = url;
  for (let hop = 0; hop < 8; hop++) {
    let response;
    try {
      response = await fetch(current, { headers: headersFor(current), redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      const code = error.cause?.code ?? error.name;
      // A site that no longer exists, against one that's slow or refusing scripts today.
      if (['ENOTFOUND', 'ECONNREFUSED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED'].includes(code)) return { state: 'broken', detail: code };
      return { state: 'unchecked', detail: code === 'TimeoutError' ? 'timed out' : code };
    }
    // Only the status is needed, not the page.
    response.body?.cancel().catch(() => {});
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    if (response.status === 404 || response.status === 410) return { state: 'broken', detail: `${response.status}`, final: current };
    if (response.status >= 400) return { state: 'unchecked', detail: `${response.status}`, final: current };
    if (current !== url && !samePage(url, current)) {
      // Sent to a home page or a section's front, which is how most sites retire a product page.
      return { state: isRoot(current) ? 'broken' : 'moved', detail: `now ${current}`, final: current };
    }
    return { state: 'ok' };
  }
  return { state: 'unchecked', detail: 'too many redirects' };
}

const results = new Map();
let done = 0;
await eachPolitely(urls, async (url) => {
  results.set(url, await check(url));
  if (++done % 100 === 0) console.error(`  ${done} of ${urls.length}`);
});

const by = (state) => urls.filter((url) => results.get(url)?.state === state);
const broken = by('broken');
const moved = by('moved');
const unchecked = by('unchecked');
const section = (title, list, note) =>
  list.length === 0
    ? ''
    : `## ${title} (${list.length})\n\n${note}\n\n` +
      list.map((url) => `- ${url} — ${results.get(url).detail}\n${uses.get(url).map((where) => `  - ${where}`).join('\n')}`).join('\n') +
      '\n\n';
const report =
  `# External links\n\n${urls.length} checked: ${by('ok').length} fine, ${broken.length} gone, ${moved.length} moved, ${unchecked.length} couldn't be checked.\n\n` +
  section('Gone', broken, 'Not found, or now sent to a home page. Replace or remove these.') +
  section('Moved', moved, 'Now redirect to another page. Check it is the same thing and update the address.') +
  section("Couldn't be checked", unchecked, 'The site refused a script, was slow or had an error. Usually fine; check by hand if one stays here.');

console.log(report);
if (reportPath) writeFileSync(reportPath, report);
process.exit(broken.length > 0 ? 1 : 0);
