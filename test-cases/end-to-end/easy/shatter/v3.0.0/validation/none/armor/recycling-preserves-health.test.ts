// rocks/recycling-preserves-health — the star hands back a damaged rock damaged.
//
// `specs/rocks.md`: a rock the star swallows "is the same rock relocated, not a
// fresh one", and under this variant "A recycled rock carries exactly the health it
// had when the star took it". So a Large chipped to one hit and slung into the core
// comes back needing one hit, not three.
//
// WHY THAT MATTERS ENOUGH TO GRADE. The obvious wrong implementation is to recycle
// by re-spawning: take the rock out and add a fresh one of the same size. Every
// other recycling rule survives that — the size is right, the count is right, the
// edge is right, the speed is right — and the only thing that gives it away is the
// health, which comes back at full. A player who has spent two rounds on a rock and
// watched the star hand it back whole has been robbed of them.
//
// THE DAMAGE IS POSED RATHER THAN SHOT ON. `setRockHealth` puts the rock at one hit
// in a single operation, which is the state this requirement concerns, and drags
// neither the gun nor the split code into a check about the star; the operation
// itself is graded by `armor/set-rock-health-reads-back`, so a build that cannot
// pose a health fails there by name. The pose is read back before the fall, so a
// failure here is the recycling and not the posing.
//
// THE RECYCLE IS FOUND AS THE RE-PLACEMENT ITSELF, not as the rock reading far from
// the star (`./scene.ts`). A build that never recycles sends its rock straight
// through the core and out the far side, where it reads exactly as far out as a
// re-placed one — and the health of a rock nothing touched is the health it was
// posed at, so this item, of all of them, is the one that would pass vacuously.
//
// THE ROCK IS FOUND IN THE ROSTER, NOT BY ITS ID. The specification makes recycling
// leave the field's rock count unchanged but never says the id survives, so a check
// that followed the id would be demanding something it does not require. The field
// holds exactly one rock throughout.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  type Harness,
} from "../harness";
import {
  FALL_FROM,
  FALL_SPEED,
  healthOf,
  slingIntoTheStar,
  theOneRock,
} from "./scene";

/** The damage the rock carries into the star: one hit left of its three. */
const CHIPPED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("re-enters a Large chipped to one hit still carrying that damage", async () => {
  await startPlaying(h);
  const id = await poseRock(
    h,
    "large",
    FALL_FROM.x,
    FALL_FROM.y,
    0,
    FALL_SPEED,
  );
  await h.debug.setRockHealth(id, CHIPPED);
  assertEqual(
    healthOf(
      requireRock(await h.snapshot(), id, "the chipped Large"),
      "the chipped Large",
    ),
    CHIPPED,
    "the health the rock carried into the star (specs/instrumentation.md)",
  );

  const recycle = await slingIntoTheStar(h);
  await captureStill(h, "recycle");

  assertEqual(
    healthOf(theOneRock(recycle.at, "the recycled rock"), "the recycled rock"),
    CHIPPED,
    "the health a recycled rock carries back (specs/rocks.md)",
  );
});
