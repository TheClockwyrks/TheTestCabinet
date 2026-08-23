// navigation/matchover-escape — Escape on the match-over screen returns to the
// title.
//
// specs/ui.md: on `matchover`, `back` returns to the title with `menuIndex = 0`.
// `Escape` drives both `pause` and `back`, and on a menu screen the build must
// read it as `back`. The snapshot does not report `menuIndex`, so the index is
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

it("returns to the title on Escape", async () => {
  await reachMatchover(h, "versus");

  await h.tap("Escape");
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
