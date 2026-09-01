// assets/missing-asset-leaves-game-running — a produced file that is
// unavailable at load costs the game its polish, not its playability.
//
// WHAT THIS DECIDES. With the moth's four sheet frames and the `hit` cue
// answered as absent for the whole life of the build, the four clauses the
// specification names, read in order off the running game: it still
// initializes, it still ticks, it still takes input, and it still draws a
// night rather than a blank wash.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Where the files land, and
// how they are loaded"): "A load that fails leaves the game running: the game
// still initializes, still ticks, still takes input, and still draws a
// legible night when a sprite or a sound is unavailable, so a missing file
// costs the game its polish rather than its playability." The four readings
// below are that sentence's four clauses, one each.
//
// WHY THESE TWO FILES. The sentence names a sprite and a sound, so one of
// each is withheld: the moth's sheet, which the game reaches for on the very
// first spawn of a run, and `hit`, which sounds the moment a weapon connects.
// Both are withheld through the transport rather than by deleting anything,
// so the workspace is untouched and every other produced file loads as it
// always does.
//
// WHY THE RUN IS A REAL ONE. The clauses are about the game as a player finds
// it, so the run is begun through `freshRun` — `reset` and the `playing`
// screen `specs/ui.md` makes LIGHT THE LAMP's own — with every driver switch
// as the build boots it, and the lamplighter is walked with a real key. No
// entity is posed and nothing is isolated: what is being read is that the
// whole game still runs, not one behavior in a cleared world.
//
// WHAT IT DELIBERATELY DOES NOT READ. What the build draws IN PLACE of the
// missing sprite, or sounds in place of the missing cue, is its own choice
// and the presentation domain's to rate. A build that decoded the moth's
// frames from bytes of its own never asks the transport for the file and
// passes, which is correct: its game did not degrade.
//
// THE TOLERANCE. The tick reading is any advance at all over thirty driven
// ticks; the input reading is any movement at all under a held key, since the
// lamplighter's speed is the movement points' figure; and "a legible night"
// is read as at least three distinct colours across the frame, the smallest
// count that separates a drawn scene from a single flat wash.

import { afterEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual, fail } from "../assert";
import {
  assetFile,
  BINDINGS,
  CUE_PATHS,
  ENEMY_FRAMES,
  enemyFrame,
} from "../constants";
import {
  captureStill,
  createHarness,
  freshRun,
  hold,
  type Harness,
} from "../harness";
import { watchRequests, type RequestWatch } from "./requests";

/** The sprite and the sound the transport answers as absent. */
const WITHHELD = new Set<string>([
  ...Array.from({ length: ENEMY_FRAMES }, (_, frame) =>
    assetFile(enemyFrame("moth", frame)),
  ),
  assetFile(CUE_PATHS.hit),
]);

/** Ticks driven with nothing held, and ticks the walk key is held for. */
const DRIVEN_TICKS = 30;
const HELD_TICKS = 10;

/** The fewest distinct colours a drawn night carries, against a flat wash. */
const MIN_COLORS = 3;

/** Distinct quantized colours on the frame, sampled on a coarse grid. */
function distinctColors(h: Harness): number {
  const { width, height } = h.canvas;
  const { data } = h.pixelRect(0, 0, width, height);
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

it("still runs with the moth sheet and the hit cue unavailable", async () => {
  watch = await watchRequests({ withhold: (url) => WITHHELD.has(url) });

  // Still initializes.
  try {
    h = await createHarness();
  } catch (error) {
    fail(
      "a game that still initializes with a produced file unavailable at load (specs/assets.md, where the files land)",
      `initialize rejected with ${[...WITHHELD].join(", ")} answered 404: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const opened = freshRun(h);
  const driven = await h.tick(DRIVEN_TICKS);
  const walked = await hold(h, BINDINGS.right[0], HELD_TICKS);
  captureStill(h, "degraded");

  // Still ticks.
  assertGreaterThan(
    driven.run.tick,
    opened.run.tick,
    `ticks resolved over ${DRIVEN_TICKS} driven ticks with the two files unavailable`,
  );
  // Still takes input.
  assertGreaterThan(
    walked.run.player.x,
    driven.run.player.x,
    `the lamplighter's x under a held ${BINDINGS.right[0]}`,
  );
  // Still draws a legible night.
  assertGreaterThanOrEqual(
    distinctColors(h),
    MIN_COLORS,
    "distinct colours on the frame — a drawn night rather than a blank wash",
  );
});
