// navigation/pause-restart — confirming RESTART on the pause menu starts the
// match over in the same mode.
//
// specs/ui.md: on `paused`, `confirm` on `RESTART` starts a match in the
// current mode: `screen = countdown`, both scores 0, `winner` null, both
// paddles at `FIELD_CY`. So that the restart has something to undo, the score
// is posed to 3-4 and both paddles are posed off center; the second entry is
// then selected with one down press and confirmed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertNull,
} from "../assert";
import { FIELD_CY } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachPlaying } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restarts the match in the same mode on RESTART", async () => {
  await reachPlaying(h, "versus");
  // A score and a paddle off center, so the restart has something to clear.
  await h.debug.setScore(3, 4);
  await h.debug.setPaddle("left", { cy: 200, vy: 0 });
  await h.debug.setPaddle("right", { cy: 500, vy: 0 });

  await h.tap("Escape");
  assertEqual((await h.snapshot()).screen, "paused");
  await h.tap("ArrowDown"); // RESUME -> RESTART
  await h.tap("Enter");
  await captureStill(h, "restarted");

  const restarted = await h.snapshot();
  assertEqual(restarted.screen, "countdown");
  assertEqual(restarted.mode, "versus");
  assertDeepEqual(restarted.score, { p1: 0, p2: 0 });
  assertNull(restarted.winner);
  assertCloseTo(restarted.paddles.left.cy, FIELD_CY, 6);
  assertCloseTo(restarted.paddles.right.cy, FIELD_CY, 6);
});
