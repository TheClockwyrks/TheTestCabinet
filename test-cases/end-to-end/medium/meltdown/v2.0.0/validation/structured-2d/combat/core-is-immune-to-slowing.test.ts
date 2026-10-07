// Meltdown — combat/core-is-immune-to-slowing: the Core carries no slow.
//
// specs/combat.md: "A unit that is not slowable never carries a slow, whatever hits it
// and whatever its factor would have been." specs/surge.md gives the Core `Slowable:
// no` — the only row on the roster that does — and `Speed: 30`.
//
// THE HARDEST SLOW ON THE ROSTER IS THE ONE AIMED AT IT. A level-III Rime pinned at
// heat `0` applies its ceiling of `0.80` (specs/combat.md, specs/towers.md), which is
// the largest fraction any tower in the game can ask for; if the immunity holds against
// that it holds against everything. A build that honoured the immunity for small slows
// and not large ones would be a strange thing, but a build that honours it for none is
// not, and this is the reading that catches it.
//
// THREE READINGS OF THE SAME REFUSAL, all in one direction: the Core reports `slowed`
// false, `slowFactor` `0`, and its own `30`. The speed is the one that matters most: a
// build can leave the factor at `0` and still stall the unit, or set the factor and
// leave the speed alone, and only the pair says the immunity actually held.
//
// AND THE SHOT IS PROVED TO HAVE LANDED. A Rime that never fired would leave an
// unslowed Core too, so the check first states that hp fell — over two fire intervals,
// so the reading does not rest on a single boundary — and reads the speed from there.
// `combat/rime-still-targets-a-core` decides the companion claim, that an immune unit
// is an ordinary target in the first place.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { SURGE_DEFS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readHp,
  slowCeilOf,
  ticksForShots,
  unitOf,
} from "./duel";

/** The hardest slow the game can apply: a level-III Rime, pinned cold. */
const TOWER = "rime";
const LEVEL = 3;
const HEAT = 0;

/** The one unit specs/surge.md marks unslowable, and its speed. */
const MARK = "core";
const BASE_SPEED = SURGE_DEFS[MARK].speed;

/** What the slow would have been, had the unit been slowable: 0.80. */
const REFUSED_FACTOR = slowCeilOf(LEVEL);

/** How many shots the drive lands before the speed is read. */
const SHOTS = 2;

/**
 * How close the unslowed speed must come, as decimal places of a logical unit per
 * second.
 *
 * Three places is `0.0005`. An immune unit's speed is its roster figure unchanged, so a
 * conformant build reads `30` exactly; the bound excludes the `6` a build that applied
 * the `0.80` would report, and every fraction of it down to a hundredth.
 */
const SPEED_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Core is immune to slowing", async () => {
  poseGun(h, TOWER, HEAT, LEVEL);
  const mark = poseMarkEast(h, TOWER, MARK, NEAR_UNITS);
  const opened = readHp(h, mark);

  await h.advance(ticksForShots(SHOTS, fireRateOf(TOWER, LEVEL)));
  captureStill(h, "immune");
  const hit = unitOf(h.snapshot(), mark);

  assertGreaterThan(
    opened - hit.hp,
    0,
    `precondition: hp the level-${LEVEL} ${TOWER} removed over ${SHOTS} shots`,
  );
  assertEqual(
    hit.slowed,
    false,
    `the ${MARK} carrying a slow after a level-${LEVEL} ${TOWER} hit it`,
  );
  assertEqual(
    hit.slowFactor,
    0,
    `the slow on the ${MARK} after a shot whose factor would have been ` +
      `${REFUSED_FACTOR}`,
  );
  assertCloseTo(
    hit.speed,
    BASE_SPEED,
    SPEED_DIGITS,
    `the ${MARK}'s speed after a level-${LEVEL} ${TOWER} hit it, against its own ` +
      `${BASE_SPEED}`,
  );
});
