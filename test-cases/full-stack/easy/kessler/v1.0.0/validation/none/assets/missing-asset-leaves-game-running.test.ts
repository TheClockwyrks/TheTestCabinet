// assets/missing-asset-leaves-game-running — a missing file costs polish, not
// playability.
//
// specs/assets.md: "A load that fails leaves the game running. The game still
// initializes, still ticks, still takes input, and still draws a legible
// field when a sprite, a system, or a sound is unavailable, so a missing file
// costs the game its polish rather than its playability."
//
// The site is served with the planet sprite withheld — every request for a
// `planet*.png` is answered 404 — and the four clauses are read in order off
// the running page: the surface comes up (initializes), the tick counter
// climbs on the build's own loop (ticks), a held rotate key moves the
// deflector (takes input), and the canvas carries more than a blank wash of
// one color (draws a legible field). Direction: only degradation under the
// withheld file is decided here; what the fallback looks like is the art
// suites' business, and a build that inlined the sprite simply never asks for
// the file and passes.

import { it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertGreaterThan, assertGreaterThanOrEqual, assertNotEqual, fail } from "../assert";
import { HANDLE } from "../surface";
import type { KesslerSnapshot } from "../surface";
import { writeImageBytes } from "./media-out";
import { openSite, type Site } from "./site";

const BLOCKED = /planet[^/]*\.png$/i;

/** Distinct quantized colors on a PNG screenshot, sampled on a coarse grid. */
async function distinctColors(png: Buffer): Promise<number> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  const seen = new Set<number>();
  const stepX = Math.max(1, Math.floor(image.width / 24));
  const stepY = Math.max(1, Math.floor(image.height / 24));
  for (let y = 0; y < image.height; y += stepY) {
    for (let x = 0; x < image.width; x += stepX) {
      const at = (y * image.width + x) * 4;
      seen.add(
        ((data[at] >> 4) << 8) | ((data[at + 1] >> 4) << 4) | (data[at + 2] >> 4),
      );
    }
  }
  return seen.size;
}

async function snap(site: Site): Promise<KesslerSnapshot> {
  return site.page.evaluate(
    (handle) =>
      (
        window as unknown as Record<string, { snapshot(): KesslerSnapshot }>
      )[handle].snapshot(),
    HANDLE,
  );
}

it("still runs with the planet sprite unavailable", async () => {
  const site = await openSite({ block: BLOCKED });
  try {
    // Still initializes.
    try {
      await site.page.waitForFunction(
        (handle) =>
          typeof (window as never)[handle] === "object" &&
          (window as never)[handle] !== null,
        HANDLE,
        { timeout: 10_000 },
      );
    } catch {
      fail(
        "a game that still initializes with a produced file unavailable at load (specs/assets.md)",
        `window.${HANDLE} was still absent 10s after the page loaded with ${String(BLOCKED)} answered 404`,
      );
    }

    // Into play, on the build's own loop.
    await site.page.evaluate(
      (handle) =>
        (
          window as unknown as Record<string, { setScreen(s: string): void }>
        )[handle].setScreen("playing"),
      HANDLE,
    );
    await site.page.waitForTimeout(300);
    const first = await snap(site);
    await site.page.waitForTimeout(500);
    const second = await snap(site);

    // Still takes input: a held rotate key moves the deflector.
    const angleBefore = second.paddle.angleDeg;
    await site.page.keyboard.down("ArrowLeft");
    await site.page.waitForTimeout(400);
    await site.page.keyboard.up("ArrowLeft");
    const third = await snap(site);

    const shot = await site.page.screenshot({ type: "png" });
    writeImageBytes("degraded", shot);

    assertGreaterThan(
      second.ticks,
      first.ticks,
      "ticks resolved while the file was unavailable — the game still ticks",
    );
    assertNotEqual(
      third.paddle.angleDeg,
      angleBefore,
      "the deflector's angle under a held ArrowLeft — the game still takes input",
    );
    assertGreaterThanOrEqual(
      await distinctColors(shot),
      3,
      "distinct colors on the canvas — a legible field rather than a blank wash",
    );
  } finally {
    await site.close();
  }
});
