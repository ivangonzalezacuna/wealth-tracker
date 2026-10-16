import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const config = await readFile('netlify.toml', 'utf8');
const csp = config.match(/Content-Security-Policy = "([^"]+)"/)?.[1];
if (!csp) throw new Error('Production CSP is missing.');
const types = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', csp);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    const data = await readFile(file);
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  } catch (error) {
    if (error instanceof URIError) response.writeHead(400).end();
    else if (error?.code === 'ENOENT') response.writeHead(404).end();
    else {
      console.error('Production test server failed to read an asset.', error);
      response.writeHead(500).end();
    }
  }
}).listen(4174, '127.0.0.1');
