// presentation/enemy-walk-frames — an enemy draws frame
// `floor(age / WALK_FRAME_TIME) mod 4` of its own sheet, for as long as it
// lives.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, Animation: "An enemy draws
// frame `floor(age / WALK_FRAME_TIME) mod 4` of its sheet for as long as it
// lives", with `WALK_FRAME_TIME` `0.1` seconds, which `specs/world.md`'s timer
// rule makes six ticks a frame. The sheet is
// `assets/sprites/enemies/<id>/0.png` to `3.png` (`specs/assets.md`, "The
// sprites"), so a blit's file name is which frame is up. `age` is the enemy's
// own field, "Seconds since it spawned" (`specs/state.md`), reported by the
// snapshot and posed by `setEnemyAge`, and `specs/world.md`'s tick raises it by
// `TICK_DT` on every tick.
//
// HOW THE EXPECTATION IS FORMED. From the `age` the SNAPSHOT reports after each
// tick, put through the formula above — not from a tick count of this suite's
// own. The rule is a function of `age` alone, so reading `age` off the state
// the specification fixes and applying the specification's formula to it is the
// honest expectation, and it is immune to how a build accumulates the field. A
// sample whose `age / WALK_FRAME_TIME` sits within `REAL_EPS` of a whole number
// is skipped, because `0.1` is not exactly representable and a build that
// accumulates and one that multiplies can land on opposite sides of a frame
// boundary; every other sample is many ulps clear.
//
// THE DRIVE. A moth posed to `age` `0.25`, which the formula puts in frame 2,
// then thirty ticks. `age` runs from `0.25` to `0.75` over them, so the frames
// read are 2, 3, 0, 1, 2, 3: the sheet in order, past the wrap from 3 to 0, and
// back. `enemyMotion` is off, which `specs/instrumentation.md` says holds the
// enemy's position and heading while "`age` and `contactCooldown` still count",
// so the moth stands still and its sprite stays at one point while the sheet
// runs.
//
// THE BOUND. None: an exact frame number on every sampled tick, off the four
// produced file names, within `SPRITE_TOL` (2 device pixels) of the enemy's own
// centre.
//
// THE WORLD, AND WHY. An isolated world holding one moth, 300 units from the
// lamplighter: far enough that no sprite of its own can be confused with the
// lamplighter's at the stage centre, and inside the `1280 x 720` view.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import { ENEMY_FRAMES, REAL_EPS, WALK_FRAME_TIME } from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { enemyFiles, framesAt } from "./sprites";

/** Where the moth stands: clear of the lamplighter and inside the view. */
const AT = { x: 300, y: -120 };

/** The age the moth is posed to, which the formula puts in frame 2. */
const POSED_AGE = 0.25;

/** How many ticks are read: `0.25` to `0.75` of age, a full wrap and more. */
const DRIVE_TICKS = 30;

/**
 * How many of those ticks may be skipped for sitting on a frame boundary. The
 * drive covers half a second of age, six `WALK_FRAME_TIME` steps, and only a
 * sample landing on a step's own edge is skipped, so at most six can be.
 */
const BOUNDARY_SAMPLES = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws frame floor(age / WALK_FRAME_TIME) mod 4 of the moth's own sheet", async () => {
  isolate(h);
  const id = placeEnemy(h, "moth", AT.x, AT.y);
  h.debug.setEnemyAge(id, POSED_AGE);

  const files = enemyFiles("moth");
  let read = 0;
  await captureReplay(h, "frames", async () => {
    for (let tick = 1; tick <= DRIVE_TICKS; tick += 1) {
      const blits = await h.frameBlits();
      const moth = enemyById(h.snapshot(), id);
      assertGreaterThan(
        moth === undefined ? 0 : 1,
        0,
        `the moth alive on tick ${tick}`,
      );
      const age = (moth as { age: number }).age;
      const steps = age / WALK_FRAME_TIME;
      // A sample sitting on a frame boundary decides nothing: skip it.
      if (Math.abs(steps - Math.round(steps)) < REAL_EPS) continue;
      const frames = framesAt(h, blits, files, AT.x, AT.y);
      assertNotNull(
        frames,
        `a produced sheet frame drawn on the moth at age ${age.toFixed(6)}`,
      );
      assertContains(
        frames as number[],
        Math.floor(steps) % ENEMY_FRAMES,
        `the sheet frame drawn on the moth at age ${age.toFixed(6)}`,
      );
      read += 1;
    }
  });

  assertGreaterThanOrEqual(
    read,
    DRIVE_TICKS - BOUNDARY_SAMPLES,
    "ticks of the drive read clear of a frame boundary",
  );
});
