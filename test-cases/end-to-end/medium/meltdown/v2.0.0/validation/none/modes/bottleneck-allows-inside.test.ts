// modes/bottleneck-allows-inside — a footprint wholly inside the zone is valid,
// places, and leaves the floor outside open for the surge.
//
// THE RULE. `specs/modes.md`: Bottleneck restricts building to the marked central
// zone, and "the floor outside the zone stays open for the surge to walk". So the
// restriction is on BUILDING alone: inside the zone a placement goes through
// exactly as it does on any other mode, and outside it the surge still crosses.
//
// WHY THIS ITEM EXISTS BESIDE THE REFUSAL. A build that refused every footprint
// on Bottleneck would satisfy `modes.bottleneck-refuses-outside` perfectly and
// make the mode unplayable. This is the other direction, and it is the direction a
// player needs.
//
// THE FOOTPRINT IS THE SAME LANCE `modes.bottleneck-refuses-outside` holds, moved
// so that all sixteen of its tiles are inside the zone. Nothing else about the
// scenario differs, so the pair of items differs in exactly the thing the rule
// turns on. The site is clear of both straight vent-to-exhaust corridors, so the
// placement is not testing the never-seal rule, and the money is posed past the
// type's cost so affordability is not what makes it valid.
//
// WHAT IS READ.
//
//   `build.valid`, which is the answer the real placement check produces
//   (`specs/instrumentation.md`) and the answer the player sees on the preview.
//
//   THAT IT REALLY PLACED. A tower of the held type standing on the held
//   footprint, appended to the roster, which is where a committed placement goes.
//
//   THAT THE SURGE CAN STILL CROSS. Both vent-to-exhaust routes are finite. That
//   is the mode's own claim about the floor outside the zone, read in the terms
//   the snapshot offers: `paths.left.length` and `paths.top.length` are route
//   lengths in tiles, and an unreachable exhaust has no finite length. What those
//   lengths ARE is the mazing group's business, so only their existence is read
//   here.
//
// WHAT THIS ITEM DOES NOT DECIDE. What placing COSTS is
// `building.place-spends-the-cost`'s, and re-pathing around a new tower is the
// mazing group's.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertLessThan,
  assertNotNull,
} from "../assert";
import { TOWER_DEFS } from "../constants";
import { IN_ZONE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  startRun,
  type BuildView,
  type Harness,
} from "../harness";

/** The type held: the same largest footprint the refusal item holds. */
const HELD = "lance";
const HELD_SIZE = TOWER_DEFS[HELD].size;

/**
 * Money far past the held type's build cost, so affordability is not what makes
 * the footprint valid.
 */
const AMPLE_MONEY = 100_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads valid, places, and leaves both vent-to-exhaust routes open", async () => {
  const { debug } = h;
  await startRun(h, "bottleneck");
  await debug.setMoney(AMPLE_MONEY);
  await debug.setArmed(HELD);
  await debug.setPreview(IN_ZONE_SITE.col, IN_ZONE_SITE.row);

  const held = await h.snapshot();
  assertNotNull(held.build, `the preview held after arming the ${HELD}`);
  const preview = held.build as BuildView;

  await debug.place();
  await h.advance(1);
  await captureStill(h, "inside");

  const after = await h.snapshot();
  assertEqual(preview.col, IN_ZONE_SITE.col, "the held footprint's column");
  assertEqual(preview.row, IN_ZONE_SITE.row, "the held footprint's row");
  assertEqual(
    preview.valid,
    true,
    `a ${HELD_SIZE}x${HELD_SIZE} footprint wholly inside the zone`,
  );

  assertLength(after.towers, 1, "towers on the floor after placing it");
  const placed = after.towers[0];
  assertEqual(placed.type, HELD, "the type that was placed");
  assertEqual(placed.col, IN_ZONE_SITE.col, "the placed tower's column");
  assertEqual(placed.row, IN_ZONE_SITE.row, "the placed tower's row");

  // A route with no way through reports an infinite length, so the bound names
  // the value a sealed floor would produce.
  assertLessThan(
    after.paths.left.length,
    Infinity,
    "the left vent's route to the right exhaust, in tiles",
  );
  assertLessThan(
    after.paths.top.length,
    Infinity,
    "the top vent's route to the bottom exhaust, in tiles",
  );
});
