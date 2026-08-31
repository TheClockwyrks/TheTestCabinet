// Meltdown — combat/damage-per-shot: a shot removes exactly its damage.
//
// `specs/combat.md`: one shot removes `baseDamage(level) * heatMultiplier(H,
// redline)` from its target's hp, where `H` is the emitter's heat at the moment
// the shot resolves. `specs/heat.md` gives the multiplier as a quadratic climb to
// the redline and a flat plateau above it, and `specs/towers.md` gives a level-I
// Arc `baseDamage` `6` and redline `80`. So one Arc shot removes `2.1` hp at heat
// `0`, `6.825` at heat `40`, and `21` at heat `80`.
//
// THREE HEATS, BECAUSE ONE FIGURE CANNOT TELL A CURVE FROM A CONSTANT. The three
// are the cold end, the middle of the climb, and the redline, and they are what
// makes each wrong model read a DIFFERENT triple:
//
//   - a build that never scales the damage reads `(6, 6, 6)`;
//   - a build whose multiplier climbs LINEARLY from `0.35` to `3.5` reads
//     `(2.1, 11.55, 21)` — right at both ends and half again too big in the
//     middle, which is why the middle sample is here;
//   - a build that measures the fraction against `100` rather than against the
//     redline reads `(2.1, 5.12, 14.2)`;
//   - a build that forgets the floor and starts the curve at `0` reads
//     `(0, 5.25, 21)`.
//
// EACH SCENARIO IS POSED FROM SCRATCH, so its emitter's fire accumulator opens at
// zero and each drive lands exactly one shot — half an interval past it, the
// furthest point in the cycle from either boundary.
//
// AND THE HEAT CANNOT MOVE UNDER THE READING. `posePinnedTower` holds the tower's
// part in the heat model (`specs/instrumentation.md`), so the shot resolves at
// exactly the heat posed rather than at whatever the thermal model had drifted to
// by the time the fire clock came round — and the plateau sample can sit at the
// redline without the trip getting in the way.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  framesForShots,
  type Harness,
} from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readHp,
  shotDamage,
} from "./duel";

/** The emitter read, at level I, and the unit its shot is read against. */
const TOWER = "arc";
const LEVEL = 1;
const MARK = "mote";

/** The cold end, the middle of the climb, and the redline (`specs/towers.md`). */
const HEATS: readonly number[] = [0, 40, 80];

/**
 * How close each removal must come, as decimal places of a hit point.
 *
 * Three places is `0.0005` hp. The reading is one subtraction of two hp values a
 * build computed from an exact product of figures the specification states
 * exactly, so a conformant build's float slack is many orders below the bound;
 * what it has to exclude is the nearest wrong model, and the closest of those —
 * the linear multiplier at heat `40` — is `4.7` hp away.
 */
const DAMAGE_DIGITS = 3;

/** The hp one shot removes from a mark, with the emitter pinned at `heat`. */
async function oneShot(harness: Harness, heat: number): Promise<number> {
  await poseGun(harness, TOWER, heat, LEVEL);
  const mark = await poseMarkEast(harness, TOWER, MARK, NEAR_UNITS);
  const opened = await readHp(harness, mark);
  await harness.advance(framesForShots(1, fireRateOf(TOWER, LEVEL)));
  return opened - (await readHp(harness, mark));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("A shot removes exactly its damage", async () => {
  const removed: number[] = [];
  for (const heat of HEATS) removed.push(await oneShot(h, heat));
  await captureStill(h, "damage");

  for (const [index, heat] of HEATS.entries()) {
    assertCloseTo(
      removed[index],
      shotDamage(TOWER, LEVEL, heat),
      DAMAGE_DIGITS,
      `hp one level-${LEVEL} ${TOWER} shot removed at heat ${heat}`,
    );
  }
});
