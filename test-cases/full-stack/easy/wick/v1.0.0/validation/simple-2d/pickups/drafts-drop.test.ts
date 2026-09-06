// Wick — pickups/drafts-drop: a common kill whose roll drops a draft leaves one
// draft at its center, beside its gem, and nothing else.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"): "only when
// it dropped no bread it drops a draft with probability `DRAFT_CHANCE`. A kill
// therefore drops at most one of the two, and the pickup lands at the enemy's
// position beside its gem." Which way the roll falls is posed:
// specs/instrumentation.md ("Drawn outcomes"), `setNextDrop(kind)`: "The next
// common enemy killed by a weapon while `drops` is on drops that pickup beside
// its gem ... in place of its roll". So a moth killed under a posed `draft`
// leaves exactly one gem and exactly one pickup, the pickup is a draft, and
// both stand at the moth's center.
//
// THE WORLD. As `pickups/bread-drops`: an isolated night with `drops` alone,
// the moth `KILL_DX` (500) units out, and a real kill by a posed Ember bolt.
//
// TOLERANCE. None on the counts and the kind; `FIGURE_TOLERANCE` on the
// centers, copies of the posed point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { killOne } from "./sample";

/** Where the moth stands: far outside every collection distance. */
const KILL_DX = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves one draft beside the gem of a kill posed to drop a draft", async () => {
  isolate(h);
  enable(h, "drops");
  h.debug.setNextDrop("draft");
  const kill = await killOne(h, "moth", KILL_DX, 0);
  captureStill(h, "drafts");

  assertLength(kill.gems, 1, "the gems the kill dropped");
  assertLength(kill.pickups, 1, "the pickups the kill dropped");
  const [draft] = kill.pickups;
  assertEqual(draft.kind, "draft", "the kind of the pickup the kill dropped");
  assertWithin(
    draft.x,
    kill.at.x,
    FIGURE_TOLERANCE,
    "the draft's x, the moth's own",
  );
  assertWithin(
    draft.y,
    kill.at.y,
    FIGURE_TOLERANCE,
    "the draft's y, the moth's own",
  );
  assertWithin(
    kill.gems[0].x,
    kill.at.x,
    FIGURE_TOLERANCE,
    "the gem's x beside it",
  );
  assertWithin(
    kill.gems[0].y,
    kill.at.y,
    FIGURE_TOLERANCE,
    "the gem's y beside it",
  );
});
