// navigation/pause-restart — confirming RESTART on the pause menu starts the
// match over in the same mode.
//
// specs/ui.md: on `paused`, `confirm` on `RESTART` starts a match in the
// current mode: `screen = countdown`, both scores 0, `winner` null, both
// paddles at `FIELD_CY`. So that the restart has something to undo, the left
// paddle is first moved off center with a held key and the score posed to 3-4;
// the second entry is then selected with one down press and confirmed.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY } from "../constants";
import {
  captureStill,
  createHarness,
  holdMove,
  MOVE_MIN,
  type Harness,
} from "../harness";
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
  const moved = await holdMove(h, "left", "KeyS");
  expect(moved.delta).toBeGreaterThan(MOVE_MIN);
  await h.debug.setScore(3, 4);

  await h.tap("Escape");
  expect((await h.snapshot()).screen).toBe("paused");
  await h.tap("ArrowDown"); // RESUME -> RESTART
  await h.tap("Enter");
  await captureStill(h, "restarted");

  const restarted = await h.snapshot();
  expect(restarted.screen).toBe("countdown");
  expect(restarted.mode).toBe("versus");
  expect(restarted.score).toEqual({ p1: 0, p2: 0 });
  expect(restarted.winner).toBeNull();
  expect(restarted.paddles.left.cy).toBeCloseTo(FIELD_CY, 6);
  expect(restarted.paddles.right.cy).toBeCloseTo(FIELD_CY, 6);
});
