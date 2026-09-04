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
//
// AND IT CAN WITHHOLD ONE. A path named in the withhold list is answered with the
// same `404` a path the build never produced gets, with every other produced file
// still served. That is the reading for "this is the produced system rather than a
// shape drawn in code at the same place": both put something on the yard, and only
// the produced one stops when its file does not arrive.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadImage } from "@napi-rs/canvas";

/** `assets/` at the root of the produced repository, as `specs/assets.md` fixes it. */
export const ASSETS = fileURLToPath(new URL("../../assets/", import.meta.url));

/** The root the engine resolves every asset path under (`packages/structured-2d`). */
const ASSET_ROOT = "assets/";

let installed = false;

/**
 * The produced paths this process is answering `404` for, under the asset root.
 *
 * Empty for every suite that just wants the files served. Replaced wholesale by
 * each call, so a suite that serves everything and then serves everything but one
 * file names the withheld one on the second call and nothing on the first.
 */
let withheld: ReadonlySet<string> = new Set();

/**
 * Answer the engine's asset requests from the produced tree, once per process,
 * withholding the paths named.
 *
 * Idempotent in what it installs, so every suite in this category may call it from
 * its own `beforeEach` without caring whether another already did. A request for
 * anything outside the asset root is handed to the host's own `fetch` untouched.
 *
 * `withhold` names produced paths RELATIVE TO THE ASSET ROOT, as
 * `specs/assets.md` writes them (`fx/aura.json`). Each one is answered with the
 * same `404` the served site answers a path the build never produced, so a check
 * can ask what the game draws WITHOUT one produced file while every other file it
 * made is still in hand. That is the only way to tell a produced system being
 * played apart from a shape the build draws in code at the same place: both put
 * something there, and only the first stops when the file does not arrive.
 */
export function serveProducedAssets(withhold: readonly string[] = []): void {
  withheld = new Set(withhold);
  if (installed) return;
  installed = true;

  const host = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(ASSET_ROOT)) return host(input, init);
    const path = url.slice(ASSET_ROOT.length);
    const at = ASSETS + path;
    if (withheld.has(path) || !existsSync(at)) {
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
