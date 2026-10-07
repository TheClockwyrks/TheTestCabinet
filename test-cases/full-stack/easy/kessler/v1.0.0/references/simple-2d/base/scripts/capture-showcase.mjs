/* global Buffer, console, process, window */
// Kessler — capture the showcase media (specs/showcase.md).
//
// The carousel's leading entry is a REPLAY: the engine's own recording of the
// frames the build drew during a sustained take of real wave-1 play, gzipped.
// The stills are screenshots of the same run.
//
// Both come from a real browser, because that is where the produced sprites
// actually decode: this script serves the project with Vite, opens the capture
// page under `scripts/showcase/`, and lets that page drive one session with
// the same key events a player's keyboard sends. Nothing here is part of the
// built site.
//
// Usage: `node scripts/capture-showcase.mjs` — writes into `showcase/`.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "showcase");

/** The stills the carousel and the description name, by the file each lands at. */
const STILLS = {
  title: "title.png",
  field: "field.png",
  howto: "how-to-play.png",
};

const server = await createServer({ root, server: { port: 5179 } });
await server.listen();
const base = `http://localhost:${server.config.server.port}`;

const browser = await chromium.launch({
  channel: process.env.KESSLER_CAPTURE_CHANNEL || undefined,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
page.on("pageerror", (error) => {
  console.error("page error:", error);
});

await page.goto(`${base}/scripts/showcase/index.html`, {
  waitUntil: "networkidle",
});
const media = await page.evaluate(() => window.captureShowcase());

await mkdir(out, { recursive: true });
await writeFile(join(out, "sweep.json.gz"), Buffer.from(media.sweep, "base64"));
for (const [name, file] of Object.entries(STILLS)) {
  const url = media.stills[name];
  if (!url) continue;
  await writeFile(join(out, file), Buffer.from(url.split(",")[1], "base64"));
}

console.log(`showcase written to ${out}`);
await browser.close();
await server.close();
