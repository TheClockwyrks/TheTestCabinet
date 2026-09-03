// instrumentation/set-screen-title — `setScreen('title')` from playing enters
// title with menuIndex 0 and the idle run, exactly as `back` on paused does.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`'s row
// for `title`: from "any", "Discards the run exactly as `TITLE` on an end
// screen or `MAIN MENU` on `paused` does: the idle run", "with `menuIndex`
// `0`". The idle run is specs/state.md's table, `hurtFlash` `0` among its rows,
// restated as `IDLE_RUN`. `almanacTab` and `almanacScroll` "are `0` on every
// screen but `almanac`" (specs/instrumentation.md, Snapshot shape), so the
// title carries both at `0`.
//
// THE POSE. The busy night, so "the idle run" is read against a run whose
// every region would betray a `setScreen` that merely flipped the screen
// field. The route is the surface alone: whether `MAIN MENU` on paused reaches
// the title is a screens point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertIdleRun, poseBusyNight } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("enters the title with the idle run over a disturbed run", async () => {
  poseBusyNight(h);
  await h.tick(1);

  h.debug.setScreen("title");
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "title");

  assertEqual(s.screen, "title", "the screen");
  assertEqual(s.menuIndex, 0, "menuIndex on arriving");
  assertEqual(s.almanacTab, 0, "almanacTab on the title");
  assertEqual(s.almanacScroll, 0, "almanacScroll on the title");
  assertIdleRun(s.run, "run on the title: the idle run");
});
