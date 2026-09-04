// instrumentation/remove-torpedo — `removeTorpedo(id)` removes exactly the
// torpedo it names. `warhead` only.
//
// THE RULE. `specs/instrumentation.md`, The torpedoes: "`removeTorpedo(id)`
// Removes the torpedo with that id" — one entity, addressed by the id `snapshot`
// reports for it, and no other.
//
// THE ONE ADDRESSED IS THE MIDDLE OF THREE. A roster of one cannot tell "removes
// the one named" from "removes the first", "removes the last", or "empties the
// roster", and every one of those is a way a build gets this wrong. With three
// posed and the middle one addressed, each wrong model leaves a different roster
// behind, so the failure names which one the build implemented.
//
// THREE AT ONCE IS ITSELF WORTH POSING. `specs/weapons.md` allows the SHIP only
// one torpedo in flight at a time, but that is a rule about the launch key, not
// about the roster: `addTorpedo` appends one on its own terms, and the roster is
// a roster. A build that stored its torpedo in a single slot rather than a list
// reports one torpedo here rather than three, and fails before the removal is
// even reached.
//
// THE SURVIVORS ARE HELD WHOLE. Not merely present: the same ids on the same
// headings at the same places, so a build that rebuilt its roster and handed out
// fresh ids fails here rather than in whichever later `warhead` scenario read
// the wrong body.
//
// THE FIELD IS EMPTY BUT FOR THEM. A torpedo looks for a target every tick and
// takes the nearest rock or saucer inside its forward cone (`specs/weapons.md`),
// so a field carrying either would put the guidance into a scenario about a
// roster operation. `startPlaying` leaves nothing for it to acquire.
//
// THE READING IS TAKEN AT THE CALL, with no frame between the pose, the removal
// and the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  torpedoById,
  torpedoesOf,
  type Harness,
} from "../harness";
import { requireOp } from "../surface";
import { poseTorpedo } from "./torpedo";

/** Where the three torpedoes hang, far apart and clear of the star's core. */
const TORPEDO_SPOTS = [
  { x: 200, y: 240 },
  { x: 200, y: 400 },
  { x: 200, y: 560 },
];

/** The heading they are posed on: straight along `+x`. */
const TORPEDO_HEADING = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the torpedo it names and leaves the other two carrying their ids", async () => {
  startPlaying(h);
  for (const at of TORPEDO_SPOTS) {
    poseTorpedo(h, at.x, at.y, TORPEDO_HEADING);
  }

  const before = h.snapshot();
  assertLength(
    torpedoesOf(before),
    TORPEDO_SPOTS.length,
    "the posed field carries three torpedoes at once",
  );

  // The middle of the three, so no wrong model passes by coincidence.
  const addressed = torpedoesOf(before)[1];
  const survivors = torpedoesOf(before).filter(
    (torpedo) => torpedo.id !== addressed.id,
  );

  requireOp(h.debug, "removeTorpedo")(addressed.id);
  const after = h.snapshot();

  assertLength(
    torpedoesOf(after),
    survivors.length,
    "one torpedo removed, no more",
  );
  assertEqual(
    torpedoById(after, addressed.id),
    undefined,
    "the torpedo the id named is gone",
  );
  for (const survivor of survivors) {
    assertDeepEqual(
      torpedoById(after, survivor.id),
      survivor,
      `the torpedo ${survivor.id} outlives the one addressed, unchanged`,
    );
  }

  // The two that outlived the one addressed.
  await h.advance(1);
  captureStill(h, "removed");
});
