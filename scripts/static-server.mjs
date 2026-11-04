import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = process.argv[2] ?? process.cwd();
const port = Number(process.argv[3] ?? 4173);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : decodeURIComponent(req.url ?? '/index.html');
  const file = join(root, path);
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, () => console.log(`static-server: http://localhost:${port} (root: ${root})`));
