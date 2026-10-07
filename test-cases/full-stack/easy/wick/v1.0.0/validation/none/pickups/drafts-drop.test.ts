// pickups/drafts-drop — a common kill whose roll drops a draft leaves one draft
// at its center, beside its gem, and nothing else.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"): "only when
// it dropped no bread it drops a draft with probability `DRAFT_CHANCE`, so a
// kill drops one pickup or none. The pickup lands at the enemy's position
// beside its gem." Which way the roll falls is posed:
// specs/instrumentation.md ("Drawn outcomes"), `setNextDrop(kind)`: "The next
// common enemy killed by a weapon while `drops` is on drops that pickup beside
// its gem ... in place of its roll". So a moth killed under a posed `draft`
// leaves exactly one gem and exactly one pickup, the pickup is a draft, and
// both stand at the moth's center.
//
// WHY THE WORLD IS POSED AS IT IS. As `pickups/bread-drops`: an isolated night
// with `drops` alone, the moth `500` units out, and a real kill by a level-1
// Ember bolt.
//
// THE TOLERANCE. None on the counts and the kind; `POSITION_TOL` on the
// centers, copies of the posed point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { killCommon, killPoint } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves one draft beside the gem of a kill posed to drop a draft", async () => {
  await isolate(h, { on: ["drops"] });
  await h.debug.setNextDrop("draft");
  const kill = await killCommon(h, "moth", killPoint(0));
  await captureStill(h, "drafts");

  assertLength(kill.gems, 1, "the gems the kill dropped");
  assertLength(kill.pickups, 1, "the pickups the kill dropped");
  const [draft] = kill.pickups;
  assertEqual(draft!.kind, "draft", "the kind of the pickup the kill dropped");
  assertNear(
    draft!.x,
    kill.at.x,
    POSITION_TOL,
    "the draft's x, the moth's own",
  );
  assertNear(
    draft!.y,
    kill.at.y,
    POSITION_TOL,
    "the draft's y, the moth's own",
  );
  assertNear(kill.gems[0]!.x, kill.at.x, POSITION_TOL, "the gem's x beside it");
  assertNear(kill.gems[0]!.y, kill.at.y, POSITION_TOL, "the gem's y beside it");
});
