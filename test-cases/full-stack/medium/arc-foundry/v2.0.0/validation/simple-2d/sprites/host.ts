// Arc Foundry — serving the produced files to the engine. CASE-PROVIDED, LOCAL TO THIS CATEGORY.
//
// WHY THIS EXISTS. The engine's asset loader resolves every path under `assets/`
// and fetches it from the page the build is served from. A check in this project
// runs in a node process with no page behind it, so under the plain harness every
// one of those requests fails, the build falls back to the geometry
// `specs/assets.md` requires it to keep, and nothing the run PRODUCED is ever
// drawn. That is the right arrangement for every other category — a build has to
// stay playable without its files — but it is the wrong one for this category,
// whose whole subject is the produced files.
//
// WHAT IT DOES. Points the host's `fetch` at the repository, so `assets/…`
// resolves to the file the run committed at that path and a path the build did
// not produce comes back `404` exactly as the served site would answer it, and
// gives the host an image decoder, since a node process has none. Nothing about
// the build changes: the engine resolves, requests, and announces exactly as it
// does in a browser, and what arrives is the file on disk.
//
// WHAT IT DELIBERATELY DOES NOT DO. Audio. A node process has no `AudioContext`,
// so the twelve produced `.wav` files still fail, and no check here reads one:
// the sounds are their own category.
//
// The verdicts in this category are decided from the FILES, read directly off
// `assets/` by `png.ts`. What this file buys is the picture beside each verdict:
// a still that shows the produced art the point is about rather than the fallback
// a build draws when its files never arrived.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadImage, type Image } from "@napi-rs/canvas";

/** The repository this project sits in, which is where `assets/` is rooted. */
const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));

let installed = false;

/**
 * Serve `assets/` off disk for the rest of this file's process, and decode what
 * comes back.
 *
 * Idempotent, and called at the top of every suite in this category that wants
 * the produced art on the canvas. Each suite file runs in its own process, so
 * installing it here reaches nothing else.
 */
export function serveProducedAssets(): void {
  if (installed) return;
  installed = true;

  globalThis.fetch = ((url: unknown): Promise<Response> => {
    let body: ArrayBuffer;
    try {
      // Copied into a plain buffer: what `readFileSync` hands back is one
      // already, but its backing store is typed loosely enough that a response
      // body will not take it, and these files are kilobytes.
      const file = readFileSync(join(REPOSITORY, String(url)));
      body = new ArrayBuffer(file.byteLength);
      new Uint8Array(body).set(file);
    } catch {
      return Promise.resolve(
        new Response(null, { status: 404, statusText: "Not Found" }),
      );
    }
    return Promise.resolve(new Response(body));
  }) as unknown as typeof fetch;

  globalThis.createImageBitmap = (async (blob: Blob): Promise<Image> =>
    loadImage(
      new Uint8Array(await blob.arrayBuffer()),
    )) as unknown as typeof createImageBitmap;
}
