// Checks every internal link in the built site points at a page or file that exists.
// Run after a build: `npm run build && npm run test:links`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = 'dist';
if (!existsSync(dist)) {
  console.error('No dist/ folder. Run `npm run build` first.');
  process.exit(1);
}

const htmlFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });

// A link to /brands/rolex/ is served from dist/brands/rolex/index.html; a link to a file is served as is.
const resolves = (url) => {
  const path = join(dist, decodeURIComponent(url));
  if (!existsSync(path)) return false;
  return statSync(path).isDirectory() ? existsSync(join(path, 'index.html')) : true;
};

const pages = htmlFiles(dist);
const broken = [];
let checked = 0;

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const [, url] of html.matchAll(/(?:href|src)="(\/[^"#?]*)[^"]*"/g)) {
    // Protocol-relative URLs (//example.com) point off-site.
    if (url.startsWith('//')) continue;
    checked++;
    if (!resolves(url)) broken.push(`${relative(dist, page)} -> ${url}`);
  }
}

if (broken.length > 0) {
  console.error(`${broken.length} broken internal link(s):`);
  for (const line of [...new Set(broken)].slice(0, 50)) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`${checked} internal links across ${pages.length} pages, none broken.`);
