// Meltdown — combat/hits-ground: an ordinary emitter damages a ground unit.
//
// specs/combat.md: "Every emitter targets ground units and flyers alike, except the
// Flak". specs/surge.md gives the Mote `Flies: no`, so an Arc with a Mote in range
// must fire on it and remove hp from it.
//
// THE COARSEST READING IN THE GROUP, AND DELIBERATELY SO. What is decided here is
// that a ground unit is a legal target at all — not the figure the shot removes
// (`combat/damage-per-shot`), not how often it comes (`combat/fires-at-its-rate`),
// not where the boundary of the radius falls (`combat/range-inside`). So the
// assertion is that hp fell, with no figure attached, and the point stands or falls
// on the one thing its title claims. Its companion `combat/hits-air` takes the
// flyer, so a build that fires on one kind and not the other is graded on exactly
// the kind it refuses.
//
// THE MARK IS THREE TILES OUT, comfortably inside the Arc's `6.0` and clear of its
// footprint, with motion off so it cannot walk away, and the drive runs half an
// interval past the first shot — the furthest point in the fire cycle from either
// boundary.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readHp,
  ticksForShots,
} from "./duel";

/** The emitter read, the heat it is pinned at, and the unit it fires on. */
const TOWER = "arc";
const HEAT = 0;
const MARK = "mote";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Emitters hit ground units", async () => {
  poseGun(h, TOWER, HEAT);
  const mark = poseMarkEast(h, TOWER, MARK, NEAR_UNITS);
  const opened = readHp(h, mark);

  await h.advance(ticksForShots(1, fireRateOf(TOWER)));
  captureStill(h, "ground");

  assertGreaterThan(
    opened - readHp(h, mark),
    0,
    `hp an ${TOWER} removed from a ground ${MARK} in range, after one ` +
      `${1 / fireRateOf(TOWER)}s interval`,
  );
});
