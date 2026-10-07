/* global Buffer, console, window */
// Deepcore — capture the showcase media (specs/showcase.md).
//
// The carousel's leading entry is a REPLAY: the engine's own recording of the
// frames the build drew, gzipped, which is what shows live play without
// re-shooting it. The stills are screenshots of the same run.
//
// Both come from a real browser, because that is where the produced sprites
// actually decode: this script serves the project with Vite, opens the capture
// page under `scripts/showcase/`, and lets that page drive one expedition with
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
  shaft: "shaft.png",
  camp: "camp.png",
  pad: "fuel-depot.png",
  hold: "cargo-hold.png",
};

const server = await createServer({ root, server: { port: 5178 } });
await server.listen();
const base = `http://localhost:${server.config.server.port}`;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (error) => {
  console.error("page error:", error);
});

await page.goto(`${base}/scripts/showcase/index.html`, {
  waitUntil: "networkidle",
});
const media = await page.evaluate(() => window.captureShowcase());

await mkdir(out, { recursive: true });
await writeFile(join(out, "dig.json.gz"), Buffer.from(media.dig, "base64"));
for (const [name, file] of Object.entries(STILLS)) {
  const url = media.stills[name];
  if (!url) continue;
  await writeFile(join(out, file), Buffer.from(url.split(",")[1], "base64"));
}

console.log(`showcase written to ${out}`);
await browser.close();
await server.close();
