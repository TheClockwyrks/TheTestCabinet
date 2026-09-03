// Wick — assets/missing-asset-leaves-game-running: a produced file that never
// arrives costs the game its polish, not its playability.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (the loading paragraph): "A load that fails leaves the
//     game running: the game still initializes, still ticks, still takes input,
//     and still draws a legible night when a sprite or a sound is unavailable,
//     so a missing file costs the game its polish rather than its playability."
//   - specs/assets.md (The sprites): the moth's walk cycle is
//     "`assets/sprites/enemies/<id>/0.png` to `3.png`", and (The sound) the
//     `hit` cue is its own file under `assets/audio/`; `constants.ts` carries
//     both paths, so the two files withheld here are named from the case's own
//     constants.
//
// THE WORLD, AND WHY IT IS POSED THIS WAY. The harness refuses to serve the
// moth's four frames and `hit.wav` while the build initializes, so those two
// loads fail and every other produced file arrives, which is exactly "a sprite
// or a sound is unavailable" rather than a build with no assets at all. On the
// isolated `playing` run that follows, one moth stands clear of the lamplighter
// so the frame has a sprite it never got to draw, and a second moth takes a
// bolt on the first tick so the build asks for the cue it never got to bind.
// Every driver switch is off and no weapon is held, so nothing but the bolt and
// the held key moves anything, and the level is `isolate`'s so no kill opens an
// overlay over the night.
//
// WHAT IS READ, IN THE FOUR CLAUSES THE SENTENCE STATES. `initialize` resolved
// (the harness was built at all); the run clock is higher after RUN_TICKS than
// before them; the lamplighter's x is higher after HELD_TICKS of a held `right`
// than it was before them; and the frame drawn last issued drawing operations
// onto a canvas carrying at least MIN_COLORS distinct colours.
//
// A BUILD THAT NEVER ASKS PASSES. Withholding is done at the transport, so a
// build that inlined a produced file into its bundle rather than fetching it
// never asks for it and cannot fail to load it, which is the sentence met
// rather than dodged. That every file is loaded through the engine's loader
// before the first frame is `assets/assets-decoded-before-first-frame`.
//
// TOLERANCE. The tick and the position are read as strict rises, of any size.
// The colour floor is the harness's own rather than the specification's: three
// quantized colours is the least a night with a ground under a lamplighter can
// show, and a build that fell back to one flat wash shows one. Whether that
// fallback looks good is the art bar the presentation domain's rating judges.
//
// WHAT IT DELIBERATELY DOES NOT READ. Only the degraded load is decided here.
// That the files exist at all is every `*-produced` point; what the game draws
// when they arrive is the presentation category's; and which cue plays which
// file is `assets/cues-bound-to-their-files`.

import { afterEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual, fail } from "../assert";
import {
  BINDINGS,
  CUE_PATHS,
  ENEMY_FRAMES,
  STAGE_H,
  STAGE_W,
  enemyFramePath,
} from "../constants";
import {
  captureStill,
  createHarness,
  drawOps,
  hold,
  isolate,
  spawnEnemyAt,
  spawnProjectileAt,
  type Harness,
  type PixelRect,
} from "../harness";

/** The moth's four walk frames and the `hit` cue, withheld at load. */
const WITHHELD: readonly string[] = [
  ...Array.from({ length: ENEMY_FRAMES }, (_unused, frame) =>
    enemyFramePath("moth", frame),
  ),
  CUE_PATHS.hit,
];

/** Where the struck moth stands, clear of the lamplighter's circle. */
const STRUCK_X = 300;
const STRUCK_Y = 0;

/** Where the standing moth stands, on the other side and on the stage. */
const STANDING_X = -300;
const STANDING_Y = 0;

/** A bolt of pierce `0`: Ember's row-1 pierce (specs/weapons.md). */
const PIERCE = 0;

/** Ticks the run is left to advance on its own. */
const RUN_TICKS = 30;

/** Ticks the `right` key is held. */
const HELD_TICKS = 30;

/** The first key specs/controls.md binds to `right`. */
const KEY = BINDINGS.right[0];

/** The least a legible night shows: a ground, a lamplighter, and one more tone. */
const MIN_COLORS = 3;

/** Distinct quantized colours on the canvas, sampled on a coarse grid. */
function distinctColors(rect: PixelRect): number {
  const seen = new Set<number>();
  const stepX = Math.max(1, Math.floor(rect.width / 32));
  const stepY = Math.max(1, Math.floor(rect.height / 32));
  for (let y = 0; y < rect.height; y += stepY) {
    for (let x = 0; x < rect.width; x += stepX) {
      const at = (y * rect.width + x) * 4;
      seen.add(
        ((rect.data[at] >> 4) << 8) |
          ((rect.data[at + 1] >> 4) << 4) |
          (rect.data[at + 2] >> 4),
      );
    }
  }
  return seen.size;
}

let h: Harness | null = null;

afterEach(() => {
  h?.dispose();
  h = null;
});

it("still runs with the moth sheet and the hit cue unavailable", async () => {
  // Still initializes.
  try {
    h = await createHarness({ withhold: WITHHELD });
  } catch (error) {
    fail(
      "a game that still initializes with a produced file unavailable at load " +
        "(specs/assets.md, a load that fails leaves the game running)",
      `initialize rejected with ${WITHHELD.join(", ")} withheld: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  isolate(h);
  spawnEnemyAt(h, "moth", STANDING_X, STANDING_Y);
  spawnEnemyAt(h, "moth", STRUCK_X, STRUCK_Y);
  spawnProjectileAt(h, "ember", STRUCK_X, STRUCK_Y, 0, 0, PIERCE);

  // The tick the bolt lands, which is the tick the build asks for the cue it
  // never got to bind.
  const struck = await h.tick(1);

  // Still ticks.
  const ticked = await h.tick(RUN_TICKS);

  // Still takes input.
  const held = await hold(h, KEY, HELD_TICKS);

  // Still draws a legible night.
  const drawn = await h.frameDraw();
  captureStill(h, "degraded");

  assertGreaterThan(
    ticked.run.tick,
    struck.run.tick,
    "the run clock over ticks driven with the two files unavailable — the " +
      "game still ticks",
  );
  assertGreaterThan(
    held.run.player.x,
    ticked.run.player.x,
    "the lamplighter's x under a held right key — the game still takes input",
  );
  assertGreaterThan(
    drawOps(drawn.calls),
    0,
    "drawing operations the frame issued — the game still draws",
  );
  assertGreaterThanOrEqual(
    distinctColors(h.pixelRect(0, 0, STAGE_W, STAGE_H)),
    MIN_COLORS,
    "distinct colours on the stage — a legible night rather than a blank wash",
  );
});
