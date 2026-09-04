// Meltdown — instrumentation/tower-thermal-gate-leaves-the-guns: pinning a tower's
// heat pins ITS HEAT, and leaves it firing at its rate and at that heat's power.
//
// THE RULE. `specs/instrumentation.md`, of `thermalEnabled`: "Off, an emitter's
// heat holds exactly where it was posed while it goes on acquiring targets, firing
// at its rate, and dealing its damage at that pinned heat."
//
// THIS IS THE OTHER HALF OF THE GATE, AND THE HALF EVERY COMBAT CHECK RESTS ON.
// `instrumentation/tower-thermal-gate` decides that the heat really holds; this
// one decides that nothing ELSE was held with it. A build that implemented the pin
// by taking the tower out of the update altogether passes that one completely —
// the heat could hardly be steadier — and turns every `combat/*` reading in this
// project into a reading of a tower that never fired, because those scenarios are
// posed through `posePinnedTower`, which is this gate.
//
// THE READING IS THE SPECIFICATION'S OWN PRODUCT, AND IT DECIDES BOTH HALVES AT
// ONCE. `specs/combat.md` puts one shot's damage at
// `baseDamage(level) * heatMultiplier(H, redline)`, and `specs/heat.md` fixes that
// multiplier as `0.35 + 3.15 * (min(H, R) / R)^2`. So the hp removed over a window
// carrying exactly `SHOTS` shots is `SHOTS` times that product, computed here from
// `specs/towers.md`'s figures for this emitter and never from what the build did.
// A build whose guns stopped removes nothing; one firing at the wrong rate removes
// a different multiple; and one that let the heat drift while it fired removes
// something between the pinned figure and the cold one. Each reads as a different
// number.
//
// POSED AT `60` AGAINST A REDLINE OF `80`, which is the distinguishing heat. It
// sits on the rising part of the curve rather than on either flat — `2.121875`,
// against `0.35` at heat `0` and `3.5` anywhere from the redline up — so a build
// that ignored the heat, or that clamped to the plateau, or that read the curve as
// linear (`2.7125` here) reads a different total.
//
// THE WINDOW STOPS HALF AN INTERVAL PAST ITS LAST SHOT (`framesForShots`), which is
// the furthest point from both boundaries of the fire clock, so `SHOTS` is what any
// conforming accumulator resolves in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  TOWER_DEFS,
  heatMultiplier,
  isEmitter,
  type TowerType,
} from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesForShots,
  posePinnedTower,
  poseTarget,
  requireTower,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/** The emitter read, the heat it is pinned at, and the shots the window carries. */
const TOWER: TowerType = "arc";
const PINNED_HEAT = 60;
const SHOTS = 3;

/** Where the target stands, in tiles right of the anchor. Geometry, not a bound. */
const TARGET_OFFSET = 5;
/** Hp far past what the window removes, so no death interrupts the reading. */
const TARGET_HP = 5000;

/** The Arc's figures at level I (`specs/towers.md`). */
const DEF = TOWER_DEFS[TOWER];
if (!isEmitter(DEF)) throw new TypeError(`${TOWER} is not an emitter`);

/** `baseDamage * heatMultiplier(60, 80)` per shot: `6 * 2.121875`. */
const EXPECTED_PER_SHOT =
  DEF.baseDamage * heatMultiplier(PINNED_HEAT, DEF.redline);
const EXPECTED_TOTAL = SHOTS * EXPECTED_PER_SHOT;

/**
 * How close the hp removed must come, in decimal places: within `0.05` hp against
 * the `38.19` the specification requires.
 *
 * The figure is a product of constants the specification states exactly, summed
 * three times, so a conformant build needs none of the room; this is the float's
 * own representation. What the bound excludes is every wrong model: two shots
 * (`25.5`), four (`50.9`), the cold multiplier (`6.3`), the plateau (`63.0`), and
 * a linear reading of the curve (`48.8`).
 */
const DAMAGE_DIGITS = 3;

/**
 * How close the pinned heat must stay, in decimal places: within `5e-5`.
 *
 * The precondition the damage figure is computed at. Firing adds `heatPerShot`
 * (`10.3` for the Arc, `specs/towers.md`) to an unpinned tower, so a gate that let
 * go is out by twenty points here rather than by a rounding.
 */
const PINNED_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires at its rate and deals its pinned-heat damage", async () => {
  await startRun(h);
  const tower = await posePinnedTower(
    h,
    TOWER,
    FREE_SITE.col,
    FREE_SITE.row,
    PINNED_HEAT,
  );
  const target = await poseTarget(
    h,
    "mote",
    FREE_SITE.col + TARGET_OFFSET,
    FREE_SITE.row,
    TARGET_HP,
  );

  await h.advance(framesForShots(SHOTS, DEF.fireRate));
  await captureStill(h, "firing");

  const s = await h.snapshot();
  const pinned = requireTower(s, tower, "the pinned Arc");
  assertCloseTo(
    pinned.heat,
    PINNED_HEAT,
    PINNED_DIGITS,
    "the heat the gate pinned while the tower fired",
  );
  assertCloseTo(
    TARGET_HP - requireUnit(s, target, "the pinned Arc's target").hp,
    EXPECTED_TOTAL,
    DAMAGE_DIGITS,
    `the hp ${SHOTS} shots of a ${TOWER} pinned at ${PINNED_HEAT} remove`,
  );
  assertCloseTo(
    pinned.damageDealt,
    EXPECTED_TOTAL,
    DAMAGE_DIGITS,
    `the damage a ${TOWER} pinned at ${PINNED_HEAT} tallies over ${SHOTS} shots`,
  );
});
