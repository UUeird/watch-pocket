// Serves the built site from dist/ for the browser tests. `astro preview` detaches into the background in some
// environments, which a test runner cannot wait on; this stays in the foreground.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 4391);
// The site is built for a base path (see astro.config.mjs), so dist/ is served under it, as GitHub Pages does.
const { default: config } = await import('../astro.config.mjs');
const base = (config.base ?? '/').replace(/\/$/, '');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
};

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
  const type = types[extname(path)] ?? 'application/octet-stream';
  const { size } = statSync(path);
  // A browser asks for part of a video to seek in it, as GitHub Pages allows.
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    response.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
    createReadStream(path, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  createReadStream(path).pipe(response);
}).listen(port, () => console.log(`Serving dist/ at http://localhost:${port}`));
