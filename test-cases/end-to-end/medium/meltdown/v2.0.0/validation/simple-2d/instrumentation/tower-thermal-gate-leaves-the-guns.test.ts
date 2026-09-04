// Meltdown — instrumentation/tower-thermal-gate-leaves-the-guns: thermal off leaves
// the guns firing.
//
// specs/instrumentation.md, the faculty gates: each gates one faculty "and nothing
// else", and of `thermalEnabled`: "Off, an emitter's heat holds exactly where it was
// posed while it goes on acquiring targets, firing at its rate, and dealing its
// damage at that pinned heat."
//
// THIS IS THE ONE THAT MAKES HALF THIS SUITE LEGITIMATE. Every combat scenario in
// this project pins a tower's heat so that a damage reading is taken at the heat it
// asked for rather than at whatever the thermal model had drifted to; if pinning also
// slowed the guns, every one of those readings would be measuring the pin. So what is
// read here is the FULL specified output of a pinned tower: `shots * baseDamage(level)
// * heatMultiplier(H, redline)`, the figure specs/combat.md gives every emitter's shot
// with no exception, at exactly the heat the pin holds.
//
// THE HEAT IS `60` AGAINST A REDLINE OF `80`, which is on the climbing part of
// specs/heat.md's curve rather than at either of its flat ends: the multiplier there
// is `0.35 + 3.15 * (60/80)^2`, which is `2.121875`, so a level-I Arc's shot removes
// `12.73125` hp. That is what makes each wrong model read a different number — a build
// that fires but ignores the heat reads `6` a shot, one whose multiplier climbs
// linearly reads `14.55`, one measuring the fraction against `100` rather than against
// the redline reads `6 * (0.35 + 3.15 * 0.36)`, which is `8.9` — and it is why a pin at
// `0` or at the redline would have been the wrong heat to read this at.
//
// FOUR SHOTS RATHER THAN ONE, so the reading is of a RATE and not of a single shot: an
// Arc's specified `2.0` shots a second (specs/towers.md) puts four of them inside the
// window, and a build that fires at half the rate or twice it reads two or eight times
// the figure. The window stops half an interval past the fourth shot, the furthest
// point in the fire cycle from either boundary, so the count is what any conforming
// accumulator produces (specs/combat.md, The fire clock).
//
// AND THE PIN IS READ BACK AT THE END, because the whole figure above is stated at the
// pinned heat: a build whose heat drifted under the window dealt its damage at some
// other multiplier and the arithmetic no longer means what it says.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  poseTarget,
  posePinnedTower,
  startRun,
  towerOf,
  unitOf,
  type Harness,
  type TowerType,
} from "../harness";
import { GUN, MARK, fireRateOf, shotDamage, ticksForShots } from "./scenes";

/** The emitter read, its level, and the heat its thermal gate pins it at. */
const TYPE: TowerType = "arc";
const LEVEL = 1;
const HEAT = 60;

/** How many shots the window carries, and the mark they land on. */
const SHOTS = 4;
const MARK_HP = 1e6;

/**
 * How closely the hp removed must match the specified figure, as decimal places.
 *
 * Three places is `0.0005` hp against a removal of `50.925`. The reading is a
 * subtraction of two hp values a build computed from an exact product of figures the
 * specification states exactly, so a conforming build's float slack is many orders
 * below the bound; what it has to exclude is the nearest wrong model, and the closest
 * of those — a shot short or a shot long — is `12.7` hp away.
 */
const DAMAGE_DIGITS = 3;

/**
 * How closely the pinned heat must still read `60` at the end, as decimal places.
 *
 * Six places is `5e-7`: a held faculty takes no part in the frame's resolution, so
 * there is nothing for a conforming build to change.
 */
const PINNED_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires at its rate and deals its damage at the pinned heat", async () => {
  startRun(h);
  const gun = posePinnedTower(h, TYPE, GUN.col, GUN.row, HEAT);
  const mark = poseTarget(h, "mote", MARK.col, MARK.row, MARK_HP);

  const opened = unitOf(h.snapshot(), mark).hp;
  await h.advance(ticksForShots(SHOTS, fireRateOf(TYPE, LEVEL)));
  const closed = h.snapshot();
  captureStill(h, "firing");

  const wanted = SHOTS * shotDamage(TYPE, LEVEL, HEAT);
  assertCloseTo(
    opened - unitOf(closed, mark).hp,
    wanted,
    DAMAGE_DIGITS,
    `hp ${SHOTS} shots of a pinned level-${LEVEL} ${TYPE} at heat ${HEAT} removed`,
  );
  assertCloseTo(
    towerOf(closed, gun).damageDealt,
    wanted,
    DAMAGE_DIGITS,
    "the damage the pinned tower tallied over the same window",
  );
  assertCloseTo(
    towerOf(closed, gun).heat,
    HEAT,
    PINNED_DIGITS,
    "the heat the shots were dealt at, read back at the end of the window",
  );
});
