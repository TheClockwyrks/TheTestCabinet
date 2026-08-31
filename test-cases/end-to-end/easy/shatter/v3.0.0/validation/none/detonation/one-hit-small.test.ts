// detonation/one-hit-small — a torpedo into a Small takes it off the field.
//
// specs/collision.md pairs a torpedo with a rock: the rock is destroyed outright
// and the torpedo is removed. specs/rocks.md leaves a destroyed `small` NOTHING —
// it is the one size that splits into no fragments, and so the only destruction
// that lowers the number of rocks on the field at all.
//
// ITS OWN CHECK, because it is the edge case of the split: `one-hit-large` and
// `one-hit-medium` both grade a torpedo that leaves two rocks behind, and a build
// that reaches for `ROCK_CHILD.small` without minding that it is `null` fails HERE
// — with a Small on an emptied field, or a pair of fragments of no size at all —
// while passing both of them.
//
// Nothing here is a tolerance: the field holds no rocks afterwards, exactly.
//
// THE STILL IS TAKEN ON THE DETONATION TICK, with no aftermath run first. What
// this item leaves behind is an empty field, so there is nothing for a later frame
// to show that this one does not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertTrue,
  assertUndefined,
} from "../assert";
import { ROCK_HEALTH } from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  rockById,
  startPlaying,
  type Harness,
} from "../harness";
import {
  QUIET_GROUND,
  driveTorpedo,
  inwardHeading,
  launchAt,
} from "./scenario";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("takes a Small off the field with one torpedo, leaving nothing", async () => {
  await startPlaying(harness);
  const parentId = await poseRock(
    harness,
    "small",
    QUIET_GROUND.x,
    QUIET_GROUND.y,
  );
  const parent = requireRock(
    await harness.snapshot(),
    parentId,
    "one-hit-small",
  );
  assertEqual(
    parent.health,
    ROCK_HEALTH.small,
    "the posed Small at full health (specs/instrumentation.md)",
  );

  const torpedo = await launchAt(harness, parent, inwardHeading(parent));
  const run = await driveTorpedo(harness, torpedo);

  await captureStill(harness, "detonation");

  assertTrue(
    run.hit,
    "the torpedo spent on the Small it was flown into (specs/collision.md)",
  );
  assertUndefined(
    rockById(run.at, parentId),
    "the Small removed by the torpedo that struck it (specs/collision.md)",
  );
  assertLength(
    run.at.rocks,
    0,
    "a destroyed Small leaving no fragments behind (specs/rocks.md)",
  );
});
