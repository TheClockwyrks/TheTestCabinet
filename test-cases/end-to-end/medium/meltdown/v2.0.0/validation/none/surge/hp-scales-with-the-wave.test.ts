// Meltdown — surge/hp-scales-with-the-wave: a unit's maximum hp is its base hp
// times the wave's scaling.
//
// THE RULE. `specs/waves.md`: "A unit released on wave `w` carries `hpScale(w)`
// times its base hp", with `hpScale(w) = 1 + 0.62 * (w - 1)`. `specs/surge.md`
// adds that the roster's HP column "is the type's base hp before the per-wave
// scaling", and `specs/instrumentation.md` makes `addUnit`'s "`maxHp` is its base
// hp scaled for the current wave" — so the wave the run stands on is what a unit
// entering it carries, and `setWave` is the pose that moves it: "the coming
// wave's type and count and THE HP SCALING follow it".
//
// THREE WAVES, BECAUSE TWO POINTS FIT TOO MANY CURVES. Waves 1, 10 and 20 of a
// twenty-wave run, which for the Mote's base `40` are `40`, `263.2` and `511.2`.
// Every wrong model this could be lands somewhere else at at least one of them:
//
//   | Model                       | w=1  | w=10   | w=20   |
//   | --------------------------- | ---- | ------ | ------ |
//   | The rule, 1 + 0.62 * (w - 1) | 40   | 263.2  | 511.2  |
//   | No scaling at all           | 40   | 40     | 40     |
//   | Off by one, 1 + 0.62 * w    | 64.8 | 288    | 536    |
//   | Compounding, 1.62 ^ (w - 1) | 40   | 4879   | 1.4e7  |
//   | Scaled by the wave number   | 40   | 400    | 800    |
//
// Wave 1 is what catches the off-by-one, which every deeper reading agrees with
// the rule to within a fifth; waves 10 and 20 are what catch a build that scales
// nothing, compounds, or multiplies by the wave. And three points on a straight
// line is what makes the reading a reading of the LINE rather than of one figure.
//
// THE MOTE IS READ AND NOT THE ROSTER. Which type carries which base hp is
// `surge/mote-stats` and its five companions; what this item decides is the
// factor the wave applies to whatever base a type has, so it is read on the row
// `specs/surge.md` calls the baseline.
//
// NOTHING IS DRIVEN AND NO WAVE IS RELEASED. The world gate stays shut, and each
// unit is entered by `addUnit`, whose scaling the specification states in the
// same words as the spawner's. A released wave would put the reading behind the
// wave-type and wave-size rules as well, which are three other items.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { SURGE_DEFS, hpScale, tileCX, tileCY } from "../constants";
import {
  captureStill,
  createHarness,
  poseWalker,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/** The type read: the roster's baseline, whose base hp is 40. */
const TYPE = "mote";
const BASE_HP = SURGE_DEFS[TYPE].hp;

/** The three waves read, and where each one's unit is stood for the picture. */
const WAVES: readonly number[] = [1, 10, 20];
const SHOW_COL = 8;
const SHOW_ROWS: readonly number[] = [8, 14, 20];

/**
 * How far a maximum hp may sit from `baseHp * hpScale(w)`, in hit points.
 *
 * `hpScale` is exact arithmetic and so is the product, so a build that computes
 * the stated expression reads the figure to the last bits of a double; half a hit
 * point is there only to admit a build that stores its maximum hp as a whole
 * number, a rounding no rule in `specs/` either states or forbids and no player
 * could see. It excludes every model in the table above: the nearest wrong figure
 * to any of the three is `24.8` away, some fifty times this bound.
 */
const MAX_HP_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("scales a Mote's maximum hp by 1 + 0.62 * (w - 1) at waves 1, 10 and 20", async () => {
  await startRun(h);

  // One unit entered on each wave, each stood on its own row so the picture shows
  // the three health bars side by side. `setUnitPosition` places the centre and
  // recomputes the route; it touches no hp (`specs/instrumentation.md`).
  const read: { wave: number; maxHp: number }[] = [];
  for (const [index, wave] of WAVES.entries()) {
    await h.debug.setWave(wave);
    const id = await poseWalker(h, TYPE, "left");
    await h.debug.setUnitPosition(
      id,
      tileCX(SHOW_COL),
      tileCY(SHOW_ROWS[index]),
    );
    const unit = requireUnit(
      await h.snapshot(),
      id,
      `the ${TYPE} entered on wave ${wave}`,
    );
    read.push({ wave, maxHp: unit.maxHp });
  }

  await h.advance(1);
  await captureStill(h, "scaled");

  for (const { wave, maxHp } of read) {
    const want = BASE_HP * hpScale(wave);
    assertLessThanOrEqual(
      Math.abs(maxHp - want),
      MAX_HP_TOLERANCE,
      `a ${TYPE} entering on wave ${wave} carries ${BASE_HP} * ` +
        `(1 + 0.62 * ${wave - 1}) = ${want} maximum hp (specs/waves.md); the ` +
        `build reported ${maxHp}, off by`,
    );
  }
});
