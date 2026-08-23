// navigation/matchover-menu — confirming MENU on the match-over screen returns
// to the title.
//
// specs/ui.md: on `matchover`, `confirm` on `MENU` returns to the title,
// restoring every declared field to its title value: `screen = title`, both
// scores 0, `winner` null, `menuIndex = 0`. The second entry is selected with
// one down press. The snapshot does not report `menuIndex`, so the index is
// read by confirming once on the title: index 0 is `SOLO`, so the match that
// opens is Solo, not the Versus match that ended.

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

it("returns to the title on MENU", async () => {
  await reachMatchover(h, "versus");

  await h.tap("ArrowDown"); // PLAY AGAIN -> MENU
  await h.tap("Enter");
  await captureStill(h, "title");

  const title = await h.snapshot();
  expect(title.screen).toBe("title");
  expect(title.score).toEqual({ p1: 0, p2: 0 });
  expect(title.winner).toBeNull();

  await h.tap("Enter");
  const opened = await h.snapshot();
  expect(opened.screen).toBe("countdown");
  expect(opened.mode).toBe("solo");
});
