// navigation/matchover-play-again — confirming PLAY AGAIN on the match-over
// screen starts a new match in the same mode.
//
// specs/ui.md: on `matchover`, `confirm` on `PLAY AGAIN` starts a match in the
// current mode: `screen = countdown`, both scores 0, `winner` null. Ending a
// match sets `menuIndex = 0`, so the first entry is the one a fresh match-over
// screen confirms. The match is ended through the build's own win rule.

import { afterEach, beforeEach, expect, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachMatchover } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a new match in the same mode on PLAY AGAIN", async () => {
  await reachMatchover(h, "versus");

  await h.tap("Enter");
  await captureStill(h, "restarted");

  const restarted = await h.snapshot();
  expect(restarted.screen).toBe("countdown");
  expect(restarted.mode).toBe("versus");
  expect(restarted.score).toEqual({ p1: 0, p2: 0 });
  expect(restarted.winner).toBeNull();
});
