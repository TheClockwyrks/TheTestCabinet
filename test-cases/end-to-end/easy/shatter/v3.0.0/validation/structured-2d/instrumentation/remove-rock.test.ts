// instrumentation/remove-rock — `removeRock(id)` removes exactly the rock it
// names.
//
// THE RULE. `specs/instrumentation.md`, The rocks: "`removeRock(id)` Removes
// the rock with that id." —
// one entity, addressed by the id `snapshot` reports for it, and no other.
//
// THE ONE ADDRESSED IS THE MIDDLE OF THREE. A roster of one cannot tell "removes
// the one named" from "removes the first", "removes the last", or "empties the
// roster", and every one of those is a way a build gets this wrong. With three
// posed and the middle one addressed, each wrong model leaves a different roster
// behind, so the failure names which one the build implemented.
//
// THE SURVIVORS ARE HELD WHOLE. Not merely present: the same ids at the same
// places with the same velocities, so a build that rebuilt its roster and handed
// out fresh ids fails here rather than downstream, where every per-id scenario
// in this suite would silently address the wrong body.
//
// AND THE OTHER ROSTERS ARE HELD TOO. A rock removed is not a rock destroyed: `specs/collision.md`
// splits and scores a destroyed rock, so a build that routed this through its
// own destruction path would leave two fragments where the rock stood and pay
// for it. The roster count and the other rosters are what catch that.
//
// THE READING IS TAKEN AT THE CALL, with no frame between the pose, the removal
// and the reading: a pose acts on the live game the moment it is made
// (`specs/instrumentation.md`), so what is compared is the operation's own
// effect and not a tick of the game's rules laid over it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  rockById,
  type Harness,
} from "../harness";
import { posePopulatedField } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the rock it names and leaves the other two carrying their ids", async () => {
  posePopulatedField(h);
  const before = h.snapshot();
  assertLength(before.rocks, 3, "the posed field carries three");

  // The middle of the three, so no wrong model passes by coincidence.
  const addressed = before.rocks[1];
  const survivors = before.rocks.filter((entry) => entry.id !== addressed.id);

  h.debug.removeRock(addressed.id);
  const after = h.snapshot();

  assertLength(after.rocks, survivors.length, "one entry removed, no more");
  assertEqual(
    rockById(after, addressed.id),
    undefined,
    "the rock the id named is gone",
  );
  for (const survivor of survivors) {
    assertDeepEqual(
      rockById(after, survivor.id),
      survivor,
      `the rock ${survivor.id} outlives the one addressed, unchanged`,
    );
  }

  assertDeepEqual(
    after.bullets,
    before.bullets,
    "the ship's bullets are left standing, unchanged",
  );
  assertDeepEqual(
    after.enemyBullets,
    before.enemyBullets,
    "the saucer's bullets are left standing, unchanged",
  );
  assertDeepEqual(
    after.saucer,
    before.saucer,
    "the saucer is left standing, unchanged",
  );

  // The two that outlived the one addressed.
  await h.advance(1);
  captureStill(h, "removed");
});
