// presentation/sconce-sheet-spins — Sconce's four-frame sheet advances one
// frame every six ticks, in order, and wraps for as long as the sconce lives.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, Animation: "A sconce draws
// frame `floor(t / WALK_FRAME_TIME) mod 4`, for `t` the seconds of ticks since
// it was fired, so it spins for its life." `WALK_FRAME_TIME` is `0.1` seconds,
// which `specs/world.md`'s timer rule makes `round(0.1 x 60)` = 6 ticks a
// frame, and the `mod 4` is the wrap. The sheet is the produced
// `assets/sprites/effects/sconce/0.png` to `3.png` (`specs/assets.md`, "The
// weapon effects"), and a blit's file name is which frame is up.
//
// WHERE THE SAMPLES SIT, AND WHY MID-RUN. One reading in the MIDDLE of each
// six-tick run, at 2, 8, 14, 20, 26, and 32 ticks after the sconce entered the
// world, where `t` is `2/60`, `8/60`, ... and the formula gives frames 0, 1, 2,
// 3, 0, 1 — a full cycle and then the wrap, which is the whole of the claim.
// Reading mid-run rather than on a boundary is deliberate: `0.1` is not exactly
// representable, so a build that accumulates `t` a tick at a time and one that
// multiplies its tick count by `TICK_DT` can land on opposite sides of a
// boundary, and neither is wrong.
//
// THE BOUND. None: six exact frame numbers, in order, off the four produced
// file names. A build that holds one frame, spins backwards, runs at another
// rate, or stops at frame 3 instead of wrapping fails on one of the six.
//
// THE WORLD, AND WHY. An isolated world holding nothing, with one sconce POSED
// through `spawnProjectile`, which `specs/instrumentation.md` gives "the
// figures the weapon would give a projectile fired on this tick" and which
// "first moves ... on the next tick", so the pose is the tick it entered the
// world and `t` counts from there. Its velocity is the level-1 row's `speed`
// along `+x`, because that file makes "a zero velocity ... invalid for
// `sconce`", and `effectMotion` is off, so it holds one place while it spins
// and its `duration` of `2.5` seconds (150 ticks) covers every sample.

import { afterEach, beforeEach, it } from "vitest";
import { INFINITE_PIERCE, SCONCE_LEVELS } from "../constants";
import { assertContains, assertNotNull } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  placeProjectile,
  projectileById,
  type Harness,
} from "../harness";
import { effectFiles, framesAt } from "./sprites";

/** Where the sconce is posed: clear of the lamplighter and inside the view. */
const AT = { x: -300, y: -180 };

/** Ticks after the sconce entered the world, and the sheet frame owed at each. */
const SAMPLES: readonly { at: number; frame: number }[] = [
  { at: 2, frame: 0 },
  { at: 8, frame: 1 },
  { at: 14, frame: 2 },
  { at: 20, frame: 3 },
  { at: 26, frame: 0 },
  { at: 32, frame: 1 },
];

/** How far the drive runs: past the last sample, inside the 150-tick life. */
const DRIVE_TICKS = 33;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("advances one sconce frame every six ticks, in order, and wraps", async () => {
  isolate(h);
  const id = placeProjectile(
    h,
    "sconce",
    AT.x,
    AT.y,
    SCONCE_LEVELS[0].speed,
    0,
    INFINITE_PIERCE,
  );

  const files = effectFiles("sconce");
  const drawn: (number[] | null)[] = [null];
  await captureReplay(h, "spin", async () => {
    for (let tick = 1; tick <= DRIVE_TICKS; tick += 1) {
      const blits = await h.frameBlits();
      const sconce = projectileById(h.snapshot(), id);
      drawn.push(
        sconce === undefined
          ? null
          : framesAt(h, blits, files, sconce.x, sconce.y),
      );
    }
  });

  for (const sample of SAMPLES) {
    const frames = drawn[sample.at];
    assertNotNull(
      frames,
      `a sconce sheet frame drawn on the sconce ${sample.at} ticks after it entered the world`,
    );
    assertContains(
      frames as number[],
      sample.frame,
      `the sconce sheet frame drawn ${sample.at} ticks after it entered the world`,
    );
  }
});
