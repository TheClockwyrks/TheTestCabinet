#!/usr/bin/env node
// Optional review aid: serve this replay bundle over HTTP and screenshot the
// renderer mid-playback with Playwright Chromium. The Node smoke test
// (smoke-test.mjs) is the required gate; this just produces a `preview.png` a
// human can eyeball. Run from the repo with the playwright-26.04 override set.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));

const MIME = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  const url = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const path = normalize(join(here, decodeURIComponent(url)));
  if (!path.startsWith(here)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(path);
    const ext = path.slice(path.lastIndexOf("."));
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 560 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(url, { waitUntil: "networkidle" });
// Wait for the engine to reconstruct and the first frame to draw.
await page.waitForFunction(() => {
  const el = document.getElementById("tick-label");
  return el && /tick \d+ \/ [1-9]/.test(el.textContent);
}, { timeout: 15000 });

// Scrub to roughly the middle of the match so agents, seeds and scores are live.
await page.evaluate(() => {
  const scrub = document.getElementById("scrub");
  scrub.value = String(Math.floor(Number(scrub.max) * 0.6));
  scrub.dispatchEvent(new Event("input"));
});
await page.waitForTimeout(300);

const out = join(here, "preview.png");
await page.screenshot({ path: out });
const tick = await page.$eval("#tick-label", (e) => e.textContent);

await browser.close();
await new Promise((r) => server.close(r));

if (errors.length) {
  console.error("page errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`wrote ${out} at ${tick}`);
