// assets/missing-asset-leaves-game-running — a missing file costs polish, not
// playability.
//
// specs/assets.md: "A load that fails leaves the game running. The game still
// initializes, still ticks, still takes input, and still draws a legible
// field when a sprite, a system, or a sound is unavailable, so a missing file
// costs the game its polish rather than its playability."
//
// The build is opened with the planet sprite withheld — every request for a
// `planet*.png` is answered 404, which the engine's loader reports as a failed
// load and rejects — and the four clauses are read in order off the running
// game: `initialize` completes (initializes), the tick counter climbs over
// driven frames (ticks), a held rotate key moves the deflector (takes input),
// and the frame carries more than a blank wash of one color (draws a legible
// field). Direction: only degradation under the withheld file is decided
// here; what the fallback looks like is the art suites' business, and a build
// that inlined the sprite simply never asks for the file and passes.

import { afterEach, it } from "vitest";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotEqual,
  fail,
} from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  hold,
  openHarness,
  poseScene,
  type Harness,
} from "../harness";
import { watchRequests, type RequestWatch } from "./asset-requests";

const WITHHELD = /planet[^/]*\.png$/i;

/** Ticks the rotate key is held: 4.5 degrees a tick, well past any rounding. */
const HELD_TICKS = 10;

/** Distinct quantized colors on the last frame, sampled on a coarse grid. */
function distinctColors(h: Harness): number {
  const { width, height } = h.canvas;
  const data = h.ctx.getImageData(0, 0, width, height).data;
  const seen = new Set<number>();
  const stepX = Math.max(1, Math.floor(width / 24));
  const stepY = Math.max(1, Math.floor(height / 24));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const at = (y * width + x) * 4;
      seen.add(
        ((data[at] >> 4) << 8) |
          ((data[at + 1] >> 4) << 4) |
          (data[at + 2] >> 4),
      );
    }
  }
  return seen.size;
}

let watch: RequestWatch | null = null;
let h: Harness | null = null;

afterEach(() => {
  h?.dispose();
  h = null;
  watch?.restore();
  watch = null;
});

it("still runs with the planet sprite unavailable", async () => {
  watch = await watchRequests({ withhold: WITHHELD });

  // Still initializes.
  try {
    h = await openHarness();
  } catch (error) {
    fail(
      "a game that still initializes with a produced file unavailable at load (specs/assets.md)",
      `initialize rejected with ${String(WITHHELD)} answered 404: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Into play, and driven.
  const first = poseScene(h, "playing");
  const second = await h.tick(30);

  // Still takes input: a held rotate key moves the deflector.
  const angleBefore = second.paddle.angleDeg;
  await hold(h, BINDINGS.left[0], HELD_TICKS);
  const third = h.snapshot();
  captureStill(h, "degraded");

  assertGreaterThan(
    second.ticks,
    first.ticks,
    "ticks resolved while the file was unavailable — the game still ticks",
  );
  assertNotEqual(
    third.paddle.angleDeg,
    angleBefore,
    `the deflector's angle under a held ${BINDINGS.left[0]} — the game still takes input`,
  );
  assertGreaterThanOrEqual(
    distinctColors(h),
    3,
    "distinct colors on the frame — a legible field rather than a blank wash",
  );
});
