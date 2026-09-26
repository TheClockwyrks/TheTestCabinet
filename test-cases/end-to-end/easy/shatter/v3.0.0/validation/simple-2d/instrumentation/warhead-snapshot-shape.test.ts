// instrumentation/warhead-snapshot-shape — the four fields `warhead` adds to the
// snapshot are reported, with the types `specs/instrumentation.md` gives them.
// `warhead` only.
//
// THE RULE. Under this variant `specs/instrumentation.md` adds `torpedoes` (a
// roster), `torpedoCharge` (a number running 0 to 1), `torpedoReady` (a boolean) and
// a `health` on every rock. A `base` build reports none of them and is correct; this
// item is named by the warhead checklist alone, so it asks for all four
// unconditionally.
//
// WHY IT IS AN ITEM OF ITS OWN. `instrumentation/snapshot-shape` is on BOTH
// checklists, and the only thing it could branch on to decide whether to demand
// these four is the build's own surface — whether it installed `addTorpedo`. That
// makes the requirement a function of what the build implemented rather than of what
// the variant requires: a `warhead` build that never wrote the torpedo would be asked
// for nothing extra and pass, while one that wrote it and mistyped a field would
// fail. A separate item cannot be shed by implementing less.
//
// THE FIELD LIST IS THE SPECIFICATION'S, NOT THIS FILE'S. `surface.ts`'s
// `TORPEDO_FIELDS` is `specs/instrumentation.md`'s own inventory of a torpedo,
// written down as types, and it is walked here exactly as its sibling walks the
// common tables.
//
// `torpedoReady` IS CHECKED AS DERIVED. `specs/instrumentation.md` makes it "true
// exactly when the charge is 1", so a build that stores a stale copy of it reports a
// flag that disagrees with the charge beside it. The charge is posed BOTH SIDES of
// the one value that makes it true, because a build that reports the flag from any
// partial charge reads identically to a conforming one at the full charge a new run
// opens with.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertCloseTo,
  assertEqual,
  assertHasProperty,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  lastTorpedo,
  poseRock,
  poseTorpedo,
  startPlaying,
  torpedoesOf,
  type Harness,
} from "../harness";
import { TORPEDO_FIELDS } from "../surface";

/** Where the one rock stands, clear of the star and of the ship's safe point. */
const ROCK_PLACE = { x: 200, y: 160 } as const;

/** Where the one torpedo sits, and the heading it is given. */
const TORPEDO_PLACE = { x: 420, y: 400 } as const;
const TORPEDO_HEADING = 0;

/**
 * The partial charge `torpedoReady` is read at.
 *
 * Half. `specs/instrumentation.md` makes the flag "true exactly when the charge is
 * 1", so anything strictly between `0` and `1` reads `false`; a half is far from
 * either end and is a value `specs/weapons.md` puts the charge at five seconds into
 * a recharge, so it is a charge a real run really holds.
 */
const PART_CHARGE = 0.5;

/**
 * The decimal places the posed charge is read back to.
 *
 * Six, which is to say exactly: `setTorpedoCharge` sets one field and
 * `snapshot().torpedoCharge` reports it, so nothing but floating-point rounding
 * separates the two.
 */
const DERIVED_DIGITS = 6;

let h: Harness;

/** Every field of `table` is present on `value` with the type the table gives it. */
function assertShape(
  value: object,
  table: Readonly<Record<string, string>>,
  what: string,
): void {
  const record = value as Record<string, unknown>;
  for (const [field, kind] of Object.entries(table)) {
    assertHasProperty(value, field, `${what}.${field}`);
    assertEqual(typeof record[field], kind, `${what}.${field}`);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the torpedo roster, the charge, the ready flag and a rock's health", async () => {
  startPlaying(h);
  poseRock(h, "large", ROCK_PLACE.x, ROCK_PLACE.y);
  poseTorpedo(h, TORPEDO_PLACE.x, TORPEDO_PLACE.y, TORPEDO_HEADING);
  await h.advance(1);
  captureStill(h, "snapshot");

  const s = h.snapshot();

  assertHasProperty(s, "torpedoes", "the warhead torpedo roster");
  assertEqual(
    Array.isArray(s.torpedoes),
    true,
    "torpedoes is a roster (specs/instrumentation.md, warhead)",
  );
  assertLength(torpedoesOf(s), 1, "the torpedo roster");
  assertShape(lastTorpedo(s), TORPEDO_FIELDS, "snapshot().torpedoes[]");
  assertEqual(typeof s.torpedoCharge, "number", "snapshot().torpedoCharge");
  assertBetween(s.torpedoCharge ?? -1, 0, 1, "torpedoCharge runs 0 to 1");
  assertEqual(typeof s.torpedoReady, "boolean", "snapshot().torpedoReady");
  for (const rock of s.rocks) {
    assertEqual(typeof rock.health, "number", "snapshot().rocks[].health");
  }

  // The ready flag against what it is built from, both sides of the one value.
  h.debug.setTorpedoCharge?.(PART_CHARGE);
  const part = h.snapshot();
  assertCloseTo(
    part.torpedoCharge ?? -1,
    PART_CHARGE,
    DERIVED_DIGITS,
    "setTorpedoCharge",
  );
  assertEqual(
    part.torpedoReady,
    false,
    `torpedoReady at a charge of ${PART_CHARGE}`,
  );

  h.debug.setTorpedoCharge?.(1);
  assertEqual(h.snapshot().torpedoReady, true, "torpedoReady at a full charge");
});
