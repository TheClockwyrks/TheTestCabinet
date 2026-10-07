// instrumentation/set-player-position-leaves-the-rest — after
// `setPlayerPosition`, every enemy, projectile, zone, gem, and pickup holds
// the position it had, and facing and hp are untouched.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md,
// `setPlayerPosition`: "Nothing else moves: the camera follows on the next
// render, and the aura and lanterns follow on the next tick". The aura and
// lanterns follow on the next TICK, so read without one they too hold.
//
// THE POSE. The busy night, ticked once so the aura is placed, then the pose
// and the snapshot read without a frame: `run` with the lamplighter's `x` and
// `y` restored is compared field for field against the reading before.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { BUSY, poseBusyNight } from "./helpers";

const MOVED_TO = { x: -700, y: 350 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the lamplighter alone", async () => {
  poseBusyNight(h);
  const before = await h.tick(1);

  h.debug.setPlayerPosition(MOVED_TO.x, MOVED_TO.y);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "held");

  assertEqual(s.run.player.x, MOVED_TO.x, "player.x after the pose");
  assertEqual(s.run.player.y, MOVED_TO.y, "player.y after the pose");
  assertEqual(s.run.player.facing, "left", "facing across the pose");
  assertEqual(s.run.player.hp, BUSY.hp, "hp across the pose");
  assertDeepEqual(
    { ...s.run, player: before.run.player },
    before.run,
    "run, but for the lamplighter's center, across the pose",
  );
});
