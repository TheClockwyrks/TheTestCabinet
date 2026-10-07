// Meltdown — combat/targets-the-unit-furthest-along: the target rule.
//
// specs/combat.md: "An emitter targets the in-range unit with the smallest
// `remaining`, which is the unit furthest along its route to its exhaust." So of
// two marks equally in range, the one nearer its exhaust is the one fired on, and
// the other is untouched.
//
// THE ARRANGEMENT IS SYMMETRIC IN EVERYTHING BUT `remaining`. Both marks are the
// same type, at the same hp, the same `95` units from the footprint centre — one
// due east, one due west — and both well inside the Arc's `114`. So distance cannot
// separate them, and nor can hp, type or flight. A unit entering the left vent is
// assigned the right exhaust for its whole life (specs/floor.md), so the east mark
// is the one further along.
//
// THE WEST MARK IS ADDED FIRST, which is the part that matters. `addUnit` appends
// to the surge roster (specs/instrumentation.md), so the west mark takes the lower
// id and the earlier place in the roster — and specs/combat.md separates a TIE by
// "taking the lower `id`". A build that takes the first in-range unit it walks
// past, or the lowest id, or the LARGEST `remaining`, therefore names the west
// mark, and each of those is a different verdict from the one the rule requires.
//
// `remaining` IS ASSERTED AS A PRECONDITION RATHER THAN COMPUTED HERE. What this
// point decides is the choice the rule makes between two values of `remaining`;
// what those values ARE is the route metric, which `mazing/*` decides. So the check
// reads the build's own two figures, states that the east mark's is the smaller —
// which is the situation the rule needs — and then grades the choice.
//
// AND THE CHOICE IS READ TWICE, both in the same direction: `targeting` names the
// east mark, and the east mark is the one whose hp falls while the west mark's does
// not. The second catches a build that reports one target and shoots another.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  eastOfGun,
  fireRateOf,
  poseGun,
  poseMarkAt,
  readGun,
  readHp,
  ticksForShots,
  unitOf,
} from "./duel";

/** The emitter read, and the heat it is pinned at. */
const TOWER = "arc";
const HEAT = 0;

/**
 * How far each mark stands from the footprint centre: five tiles.
 *
 * Geometry, not a tolerance. `95` units is inside the Arc's `114` with a tile to
 * spare on either side of the boundary, and clear of the 2x2 footprint, so neither
 * mark's presence in range is in question and the point turns on the choice between
 * them alone.
 */
const OFFSET_UNITS = 95;

const EAST = eastOfGun(TOWER, OFFSET_UNITS);
const WEST = eastOfGun(TOWER, -OFFSET_UNITS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("An emitter targets the unit furthest along", async () => {
  const gunId = poseGun(h, TOWER, HEAT);
  // The west mark first, so the lower id belongs to the wrong answer.
  const west = poseMarkAt(h, "mote", WEST.x, WEST.y);
  const east = poseMarkAt(h, "mote", EAST.x, EAST.y);

  const openedEast = readHp(h, east);
  const openedWest = readHp(h, west);

  await h.advance(ticksForShots(1, fireRateOf(TOWER)));
  captureStill(h, "furthest");
  const closing = h.snapshot();
  const gun = readGun(h, gunId);

  assertLessThan(
    unitOf(closing, east).remaining,
    unitOf(closing, west).remaining,
    "precondition: the east mark is the one further along its route",
  );
  assertEqual(
    gun.targeting,
    east,
    "the unit targeted of two marks the same distance out, the east one " +
      "further along its route and holding the higher id",
  );
  assertGreaterThan(
    openedEast - unitOf(closing, east).hp,
    0,
    "hp removed from the mark further along, after one fire interval",
  );
  assertEqual(
    openedWest - unitOf(closing, west).hp,
    0,
    "hp removed from the mark further back, after one fire interval",
  );
});
