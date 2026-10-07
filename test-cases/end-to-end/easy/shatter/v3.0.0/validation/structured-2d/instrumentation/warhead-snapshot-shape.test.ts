// instrumentation/warhead-snapshot-shape — the three fields `warhead` adds to the
// snapshot are reported, with the types `specs/instrumentation.md` gives them, and a
// rock carries its `health`. `warhead` only.
//
// THE RULE. Under this variant `specs/instrumentation.md` adds `torpedoes` (an
// array), `torpedoCharge` (a number) and `torpedoReady` (a boolean, "true exactly
// when the charge is 1"), and gives every rock a `health`. A `base` build reports
// none of them and is correct.
//
// WHY IT IS AN ITEM OF ITS OWN. `instrumentation/snapshot-shape` is on BOTH
// checklists, and the only thing it could branch on to decide whether to demand
// these is the build's own surface — whether it carries `addTorpedo`. That makes the
// requirement a function of what the build implemented rather than of what the
// variant requires: a `warhead` build that never wrote the torpedo would be asked
// for nothing extra and pass, while one that wrote it and mistyped a field would
// fail. A separate item cannot be shed by implementing less.
//
// THE FIELD LIST IS THE SPECIFICATION'S, NOT THIS FILE'S. `surface.ts`'s
// `WARHEAD_SNAPSHOT_FIELDS` is that document's own inventory of what the variant
// adds, and it is walked here exactly as its sibling walks the common tables.
//
// `torpedoReady` IS CHECKED AS DERIVED, the way its sibling checks `ship.speed`:
// `specs/instrumentation.md` has it built at the call from the charge beside it, so
// a build that stores a stale copy reports a flag that disagrees with that charge.
// The charge is posed BOTH SIDES of the one value that makes it true, because a
// build that reports the flag from any partial charge reads identically to a
// conforming one at the full charge a new run opens with.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertHasProperty,
  assertLength,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  torpedoesOf,
  type Harness,
} from "../harness";
import { requireOp, WARHEAD_SNAPSHOT_FIELDS } from "../surface";
import { poseTorpedo } from "./torpedo";

/** Where the one rock stands, clear of the star and of the ship's safe point. */
const ROCK_SPOT = { x: 200, y: 160 } as const;

/** Where the one torpedo sits, and the heading it is given. */
const TORPEDO_SPOT = { x: 1080, y: 160 } as const;
const TORPEDO_HEADING = 0;

/**
 * The partial charge `torpedoReady` is read at.
 *
 * Half: anything strictly between `0` and `1` reads `false`, and a half is far from
 * either end and is a value `specs/weapons.md` puts the charge at five seconds into
 * a recharge, so it is a charge a real run really holds.
 */
const PART_CHARGE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the torpedo roster, the charge, the ready flag and a rock's health", async () => {
  startPlaying(h);
  poseRock(h, "large", ROCK_SPOT.x, ROCK_SPOT.y);
  poseTorpedo(h, TORPEDO_SPOT.x, TORPEDO_SPOT.y, TORPEDO_HEADING);
  await h.advance(1);
  captureStill(h, "snapshot");

  const snapshot = h.snapshot();

  for (const field of WARHEAD_SNAPSHOT_FIELDS) {
    assertHasProperty(snapshot, field, "a documented warhead snapshot field");
  }
  assertTrue(Array.isArray(snapshot.torpedoes), "torpedoes is an array");
  assertLength(torpedoesOf(snapshot), 1, "the posed torpedo on the roster");
  assertEqual(
    typeof snapshot.torpedoCharge,
    "number",
    "torpedoCharge is a number",
  );
  assertEqual(
    typeof snapshot.torpedoReady,
    "boolean",
    "torpedoReady is a boolean",
  );

  assertLength(snapshot.rocks, 1, "the posed rock on the roster");
  for (const rock of snapshot.rocks) {
    assertEqual(typeof rock.health, "number", "rocks[].health is a number");
  }

  // The ready flag against what it is built from, both sides of the one value.
  const setCharge = requireOp(h.debug, "setTorpedoCharge");
  setCharge(PART_CHARGE);
  assertEqual(
    h.snapshot().torpedoReady,
    false,
    `torpedoReady at a charge of ${String(PART_CHARGE)} — it is true exactly ` +
      "when the charge is 1, built at the call (specs/instrumentation.md)",
  );

  setCharge(1);
  assertEqual(
    h.snapshot().torpedoReady,
    true,
    "torpedoReady at a full charge (specs/instrumentation.md)",
  );
});
