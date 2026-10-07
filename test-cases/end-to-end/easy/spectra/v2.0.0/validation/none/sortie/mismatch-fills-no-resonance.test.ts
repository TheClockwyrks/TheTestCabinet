// sortie/mismatch-fills-no-resonance — a mismatched shot adds nothing to the meter.
//
// specs/mode.md (Sortie): the wasted shot "adds nothing to the score and nothing
// to the resonance meter". specs/resonance.md agrees from the other side — it
// names exactly two events that fill the meter, an absorbed same-band enemy
// bullet (`RESONANCE_ABSORB` 6) and a matching kill (`RESONANCE_KILL` 4), and
// closes with "Nothing else moves the meter."
//
// THE METER IS SEEDED AWAY FROM ZERO AND AWAY FROM ITS CEILING, at SEEDED_METER.
// Both matter. Away from zero, a build that fills on a mismatch reads a number
// that names which figure it paid: `SEEDED_METER + RESONANCE_KILL` for a build
// that treats a wasted shot as a kill, `SEEDED_METER + RESONANCE_ABSORB` for one
// that treats it as an absorb, and `0` for one that empties the meter. Away from
// `RESONANCE_MAX` (100), a wrong fill has room to show: seeded at the ceiling the
// cap would swallow it and the check would pass a build that fills.
//
// The whole drive is 0.4 s, which is why the seeded reading is safe to compare
// exactly: that the meter does not decay with time is `resonance`'s own item, and
// no build could decay perceptibly over four tenths of a second anyway.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FORM_CENTER_X, RESONANCE_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the target Shard stands. As in `bands/mismatch-spares`. */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6), so the bullet starts well
 * clear and climbs into the drone.
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet reaches the drone inside 16 frames and, consumed or not, is
 * 88 units past its centre by frame 30 — so the crossing has certainly happened
 * however the build resolves it.
 */
const SHOT_FRAMES = 30;

/**
 * Frames run after the shot has resolved, before the meter is read.
 *
 * A tenth of a second, so a build that fills the meter a frame or two after the
 * contact is caught rather than read too early. Nothing a conformant build does
 * fills it over them: nothing is destroyed and nothing reaches the ship.
 */
const SETTLE_FRAMES = 10;

/**
 * The meter's reading when the shot is fired.
 *
 * `RESONANCE_MAX / 2`: high enough that a build which empties the meter reads a
 * different number, and low enough that either of the two fills specs/resonance.md
 * knows — `RESONANCE_ABSORB` (6) and `RESONANCE_KILL` (4) — would land well short
 * of the ceiling and so be visible rather than clipped. It is also not a discharge
 * (a discharge needs exactly `RESONANCE_MAX`), so nothing in the scenario can
 * spend it either.
 */
const SEEDED_METER = RESONANCE_MAX / 2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("fills nothing for a shot of the band opposite the drone's", async () => {
  await startPosed(harness);
  await harness.debug.setResonance(SEEDED_METER);
  const target = await poseDrone(harness, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
  });

  const shot = await shootDrone(harness, target, "magenta", {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await harness.advance(SETTLE_FRAMES);
  await captureStill(harness, "meter");

  const after = await harness.snapshot();
  assertEqual(
    shot.hit,
    true,
    "the mismatched bullet resolving on the drone inside the frames its climb takes — a mismatched shot is consumed on contact (specs/bands.md), so the bullet leaving the roster is the evidence the shot arrived at all, and without it a build whose bullet never moves would satisfy every unchanged reading below",
  );
  assertEqual(
    after.resonance,
    SEEDED_METER,
    "the resonance meter, which a mismatched shot adds nothing to (specs/mode.md)",
  );
});
