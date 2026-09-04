// assets/missing-asset-leaves-game-running — a missing file costs polish, not
// playability.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Where the files land, and how
// they are loaded"): "A load that fails leaves the game running: the game still
// initializes, still ticks, still takes input, and still draws a legible night
// when a sprite or a sound is unavailable, so a missing file costs the game its
// polish rather than its playability."
//
// THE DRIVE. The site is served with the moth's walk sheet and the `hit` cue
// withheld — every request for either is answered `404` — and the four clauses are
// read in order off the running page: the surface comes up (initializes), the run
// clock climbs on the build's own loop (ticks), a held `right` key moves the
// lamplighter (takes input), and the canvas carries more than a wash of one
// colour (draws a legible night). This suite brings its own server for that, since
// the project's shared one serves every file; nothing about the build is changed.
//
// A BUILD THAT NEVER ASKS PASSES. A bundler is free to inline a small produced
// file into the script rather than emit it beside one, and a file that is never
// requested cannot fail to load — which is the sentence met rather than dodged.
// The withholding is therefore written against the names a build serves those
// files under, hashed or not, and a build that inlined them simply runs.
//
// THE TOLERANCE. The distinct-colour floor is the harness's own, not the
// specification's: three quantized colours on a coarse grid is the least a night
// with a lamplighter and a ground under him can show, and a build that fell back
// to a single flat wash shows one. Whether the fallback looks good is the art bar
// and the presentation domain's aesthetic rating.
//
// WHAT IT DELIBERATELY DOES NOT READ. Direction: only the degraded load is
// decided here. That the files exist at all is every `*-produced` point, and what
// the game draws when they are present is the presentation category's.

import { it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertGreaterThan, assertGreaterThanOrEqual, fail } from "../assert";
import { BINDINGS, HANDLE } from "../constants";
import type { WickSnapshot } from "../harness";
import { writeImageBytes } from "./media-out";
import { openSite, type Site } from "./site";

/**
 * The moth's four walk frames and the `hit` cue, as a build serves them.
 *
 * A bundler flattens `assets/sprites/enemies/moth/0.png` to `0-<hash>.png` and
 * `assets/audio/hit.wav` to `hit-<hash>.wav`, while a build that keeps its tree
 * serves the paths themselves; both spellings are withheld. The flattened form
 * takes the other sheets' frames of the same number with it, which only widens
 * the withholding.
 */
const BLOCKED = /(^|\/)(?:[0-3](-[\w$-]+)?\.png|hit(-[\w$-]+)?\.wav)$/i;

/** How long the surface is waited for before the degraded load is a failure. */
const SURFACE_TIMEOUT_MS = 15_000;

/** How long the build's own loop is left running between two readings. */
const RUN_MS = 500;

/** How long a held key is left down. */
const HOLD_MS = 400;

/** The least a legible night shows: a ground, a lamplighter, and one more tone. */
const MIN_COLORS = 3;

/** Distinct quantized colours on a screenshot, sampled on a coarse grid. */
async function distinctColors(png: Buffer): Promise<number> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  const seen = new Set<number>();
  const stepX = Math.max(1, Math.floor(image.width / 32));
  const stepY = Math.max(1, Math.floor(image.height / 32));
  for (let y = 0; y < image.height; y += stepY) {
    for (let x = 0; x < image.width; x += stepX) {
      const at = (y * image.width + x) * 4;
      seen.add(
        ((data[at]! >> 4) << 8) |
          ((data[at + 1]! >> 4) << 4) |
          (data[at + 2]! >> 4),
      );
    }
  }
  return seen.size;
}

/** Read the running game's snapshot through its own surface. */
function snapshot(site: Site): Promise<WickSnapshot> {
  return site.page.evaluate(
    (handle) =>
      (window as unknown as Record<string, { snapshot(): WickSnapshot }>)[
        handle
      ]!.snapshot(),
    HANDLE,
  );
}

it("still runs with the moth sheet and the hit cue unavailable", async () => {
  const site = await openSite({ block: BLOCKED });
  try {
    // Still initializes.
    try {
      await site.page.waitForFunction(
        (handle) =>
          typeof (window as unknown as Record<string, unknown>)[handle] ===
          "object",
        HANDLE,
        { timeout: SURFACE_TIMEOUT_MS },
      );
    } catch {
      fail(
        "a game that still initializes with a produced file unavailable at load",
        `window.${HANDLE} was still absent ${
          SURFACE_TIMEOUT_MS / 1000
        }s after the page loaded with ${String(BLOCKED)} answered 404`,
      );
    }

    // Into play, on the build's own loop: `setScreen` stands the game on
    // `playing`, and the loop runs it from there in real time.
    await site.page.evaluate(
      (handle) =>
        (
          window as unknown as Record<string, { setScreen(name: string): void }>
        )[handle]!.setScreen("playing"),
      HANDLE,
    );
    await site.page.waitForTimeout(RUN_MS);
    const first = await snapshot(site);
    await site.page.waitForTimeout(RUN_MS);
    const second = await snapshot(site);

    // Still takes input: a held `right` key moves the lamplighter.
    const before = second.run.player.x;
    await site.page.keyboard.down(BINDINGS.right[0]!);
    await site.page.waitForTimeout(HOLD_MS);
    await site.page.keyboard.up(BINDINGS.right[0]!);
    const third = await snapshot(site);

    const shot = await site.page.screenshot({ type: "png" });
    writeImageBytes("degraded", shot);

    assertGreaterThan(
      second.run.tick,
      first.run.tick,
      "the run clock while the files were unavailable — the game still ticks",
    );
    assertGreaterThan(
      third.run.player.x,
      before,
      "the lamplighter's x under a held right key — the game still takes input",
    );
    assertGreaterThanOrEqual(
      await distinctColors(shot),
      MIN_COLORS,
      "distinct colours on the canvas — a legible night rather than a blank wash",
    );
  } finally {
    await site.close();
  }
});
