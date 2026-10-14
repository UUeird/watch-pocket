// Serves the built site from dist/ for the browser tests. `astro preview` detaches into the background in some
// environments, which a test runner cannot wait on; this stays in the foreground.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 4322);
// The site is built for a base path (see astro.config.mjs), so dist/ is served under it, as GitHub Pages does.
const { default: config } = await import('../astro.config.mjs');
const base = (config.base ?? '/').replace(/\/$/, '');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

createServer((request, response) => {
  const url = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (!url.startsWith(`${base}/`)) {
    response.writeHead(404).end('Not found');
    return;
  }
  let path = join('dist', normalize(url.slice(base.length)));
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!path.startsWith('dist') || !existsSync(path)) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(response);
}).listen(port, () => console.log(`Serving dist/ at http://localhost:${port}`));
