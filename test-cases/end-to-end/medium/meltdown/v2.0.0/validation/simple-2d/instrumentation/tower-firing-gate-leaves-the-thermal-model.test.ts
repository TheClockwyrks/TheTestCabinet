// Meltdown — instrumentation/tower-firing-gate-leaves-the-thermal-model: firing off
// leaves the heat model running.
//
// specs/instrumentation.md, the faculty gates: each gates one faculty "and nothing
// else", and of `firingEnabled`: "Off, the tower's thermal model runs exactly as an
// idle tower's does: it cools, conducts, exchanges with movers, and trips."
//
// THE READING IS A COMPARISON, NOT A FIGURE, and that is deliberate. What the
// specification promises is a SAMENESS — the held tower cools by what an idle one
// cools by — so the check drives both and compares them. How much an Arc cools by
// in a second is specs/heat.md's business and `heat`'s item; a build whose air term
// is wrong is failed there, and must still pass here, because its two towers are
// wrong in exactly the same way.
//
// THE TWO LEGS DIFFER IN ONE THING AND ONE THING ONLY. Both are an Arc posed at heat
// `60` on the same anchor, in the same open air, on a floor that is otherwise empty,
// over the same second of game time. The held leg has a mark standing in range with
// its guns held; the idle leg has nothing to shoot at and its guns free. So the only
// difference between them is whether a tower that COULD fire was stopped from doing
// so, which is the faculty under test.
//
// AND THE COMPARISON IS NOT ALLOWED TO BE VACUOUS. A tower whose heat never moves at
// all would agree with itself perfectly, so the idle leg must first be seen to cool:
// specs/heat.md sheds `(RAD_K * radiatorEdges + BASE_K * plainEdges) * H / 100` per
// second, which for a 2x2 Arc at heat `60` is a shed of more than eleven, so a
// requirement of one whole degree is a tenth of the specified cooling and cannot be
// met by a build that is merely drifting.
//
// WHAT A WRONG BUILD READS. A build that runs the fire clock behind the gate and
// adds the `heatPerShot` of every shot it resolved gains `10.3` per shot at the Arc's
// two shots a second (specs/towers.md), so its held leg ends more than twenty degrees
// above its idle one. A build that holds the whole thermal model along with the guns
// ends the held leg exactly where it started, sixty against the idle leg's forty-nine.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTarget,
  poseTower,
  startRun,
  ticksFor,
  towerOf,
  type Harness,
} from "../harness";
import { GUN, MARK } from "./scenes";

/** The emitter read, and the heat it is posed at. */
const TYPE = "arc";
const HEAT = 60;

/** The mark's hp: far past anything a second of fire removes. */
const MARK_HP = 1e6;

/** The window each leg is read over: one second of game time. */
const WINDOW_TICKS = ticksFor(1);

/**
 * How closely the two legs must agree on the heat they lost, in degrees.
 *
 * A hundredth of a degree. Both legs are the same tower on the same anchor over the
 * same second, so a conforming build resolves them through the identical arithmetic
 * and the only difference available is the representation of it. What the bound has
 * to exclude is a build that adds a shot's heat behind the gate: an Arc's
 * `heatPerShot` is `10.3` (specs/towers.md), so the nearest wrong reading is a
 * thousand times this bound away.
 */
const AGREEMENT_DEGREES = 0.01;

/**
 * How much the idle leg must cool by for the comparison to mean anything, in
 * degrees.
 *
 * One degree. specs/heat.md sheds `(RAD_K * 4 + BASE_K * 4) * 60 / 100` per second
 * from a 2x2 Arc standing in open air, which is over eleven degrees, so this is a
 * tenth of the specified figure — enough to say the thermal model is RUNNING without
 * asserting the rate `heat` owns.
 */
const COOLING_MIN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose an Arc at `HEAT` on the same anchor, run the window, and read what it lost. */
async function cooledOver(
  withHeldGuns: boolean,
  output?: string,
): Promise<number> {
  startRun(h);
  const gun = poseTower(h, TYPE, GUN.col, GUN.row);
  if (withHeldGuns) {
    h.debug.setTowerFiring(gun, false);
    poseTarget(h, "mote", MARK.col, MARK.row, MARK_HP);
  }
  h.debug.setTowerHeat(gun, HEAT);

  const opened = towerOf(h.snapshot(), gun).heat;
  await h.advance(WINDOW_TICKS);
  const closed = towerOf(h.snapshot(), gun).heat;
  if (output !== undefined) captureStill(h, output);
  return opened - closed;
}

it("cools a held gun by exactly what an idle tower of the same layout cools by", async () => {
  const idle = await cooledOver(false);
  assertGreaterThan(
    idle,
    COOLING_MIN,
    "degrees an idle Arc in open air sheds over a second, so the comparison is not vacuous",
  );

  const heldGuns = await cooledOver(true, "cooling");
  assertLessThanOrEqual(
    Math.abs(heldGuns - idle),
    AGREEMENT_DEGREES,
    "degrees between what a tower with its guns held cooled by and what an idle one cooled by",
  );
});
