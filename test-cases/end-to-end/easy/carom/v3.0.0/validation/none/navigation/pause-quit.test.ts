// navigation/pause-quit — confirming QUIT TO MENU on the pause menu returns to
// the title.
//
// specs/ui.md: on `paused`, `confirm` on `QUIT TO MENU` returns to the title,
// restoring every declared field to its title value: `screen = title`, both
// scores 0, `menuIndex = 0`. The score is posed to 3-4 first so the return has
// something to clear; the third entry is selected with two down presses. The
// snapshot does not report `menuIndex`, so the index is read by confirming once
// on the title: index 0 is `SOLO`, so the match that opens is Solo, not the
// Versus match that was quit.

import { afterEach, beforeEach, expect, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachPlaying } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title on QUIT TO MENU", async () => {
  await reachPlaying(h, "versus");
  await h.debug.setScore(3, 4);

  await h.tap("Escape");
  expect((await h.snapshot()).screen).toBe("paused");
  await h.tap("ArrowDown"); // RESUME -> RESTART
  await h.tap("ArrowDown"); // RESTART -> QUIT TO MENU
  await h.tap("Enter");
  await captureStill(h, "title");

  const title = await h.snapshot();
  expect(title.screen).toBe("title");
  expect(title.score).toEqual({ p1: 0, p2: 0 });

  await h.tap("Enter");
  const opened = await h.snapshot();
  expect(opened.screen).toBe("countdown");
  expect(opened.mode).toBe("solo");
});
