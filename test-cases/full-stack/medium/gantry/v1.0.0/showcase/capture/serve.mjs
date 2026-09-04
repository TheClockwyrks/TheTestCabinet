// A static file server for the reference build's `dist/`.
//
// An engineless Gantry build is a static site: `npm run build` writes `dist/`
// and the game is whatever a browser makes of it. Nothing here is Gantry's — it
// serves bytes off a loopback port so Playwright has something to open.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Serve `root` on an ephemeral loopback port. Answers `{ url, close }`. */
export async function serveDist(root) {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = path.join(root, rel);
    // Nothing outside the build's own output is reachable.
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type":
          TYPES[path.extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
