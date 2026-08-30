// Arc Foundry — serving the produced files to the engine's asset loader.
// CASE-PROVIDED.
//
// WHY THIS EXISTS. The harness builds a real engine over a canvas in a node
// process, and the engine's asset loader resolves every path under `assets/` and
// fetches it. There is no page behind that fetch here and no image decoder in the
// host, so left alone every one of the produced files fails to arrive and the game
// runs on the fallback geometry `specs/assets.md` requires it to keep. That is the
// right reading for a check about the GAME. It is the wrong reading for a check
// about a PRODUCED FILE BEING PLAYED: "a shower of sparks and a snap of arc at the new
// footprint" cannot be decided from a build that was never given the system to
// play, and `spawnBurst` has nothing to spawn.
//
// SO THE FILES ARE SERVED, AND NOTHING ELSE IS CHANGED. Two host facilities the
// browser has and node does not are supplied, and both are supplied at the HOST
// rather than at the engine or the build: `fetch`, which answers a path under the
// asset root from the produced tree on disk, and `createImageBitmap`, which decodes
// a PNG through the same `@napi-rs/canvas` the harness draws with. The engine
// resolves the path, applies its own root rule, fetches, decodes and announces the
// attempt exactly as it does in a browser, and the build asks for its files exactly
// as it always does. Nothing here reaches into the engine, the build, or the
// harness.
//
// WHAT STILL DOES NOT ARRIVE. The twelve `.wav` cues, because decoding audio needs
// a Web Audio context and the host has none — so `audio/<cue>.wav` fails here as it
// always did, and nothing in this category listens for a sound.
//
// ONE COPY PER CATEGORY, DELIBERATELY. Each category owns the helpers its own
// suites import, as every category in this project does, so a category can be read
// and moved on its own. The two copies are the same file but for the paragraph
// above naming what this category needs served.
//
// THIS IS A HOST FACILITY, NOT A FIXTURE. It serves whatever the build committed,
// so a build that authored no system still gets none, a build that authored an
// empty one still gets that, and every point that reads a produced file off disk
// reads the same bytes the loader was handed.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadImage } from "@napi-rs/canvas";

/** `assets/` at the root of the produced repository, as `specs/assets.md` fixes it. */
export const ASSETS = fileURLToPath(new URL("../../assets/", import.meta.url));

/** The root the engine resolves every asset path under (`packages/simple-2d`). */
const ASSET_ROOT = "assets/";

let installed = false;

/**
 * Answer the engine's asset requests from the produced tree, once per process.
 *
 * Idempotent, so every suite in this category may call it from its own
 * `beforeEach` without caring whether another already did. A request for anything
 * outside the asset root is handed to the host's own `fetch` untouched.
 */
export function serveProducedAssets(): void {
  if (installed) return;
  installed = true;

  const host = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(ASSET_ROOT)) return host(input, init);
    const at = ASSETS + url.slice(ASSET_ROOT.length);
    if (!existsSync(at)) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    return Promise.resolve(new Response(readFileSync(at)));
  }) as typeof globalThis.fetch;

  // The one decode the engine asks the host for. `@napi-rs/canvas`'s image is what
  // its own 2D context draws, and the harness's canvas is one of those, so a
  // decoded frame reaches `drawImage` exactly as an `ImageBitmap` does in a page.
  const scope = globalThis as {
    createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
  };
  scope.createImageBitmap = async (blob: Blob): Promise<ImageBitmap> => {
    const bytes = Buffer.from(await blob.arrayBuffer());
    const image = await loadImage(bytes);
    // A no-op `close`, because that is the one member of `ImageBitmap` a game may
    // reach for that a decoded image does not carry, and a build releasing a frame
    // it has finished with must not fault on the host that decoded it.
    return Object.assign(image, { close: () => {} }) as unknown as ImageBitmap;
  };
}
