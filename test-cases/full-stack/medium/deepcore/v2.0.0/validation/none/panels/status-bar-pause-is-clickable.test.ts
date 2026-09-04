// panels/status-bar-pause-is-clickable — the status bar's pause control answers a
// press.
//
// `specs/controls.md`: "A pointer pressed and released, or a touch contact landed
// and lifted, inside one panel or status-bar control's region: that control acts,
// exactly as its keyboard route does."
//
// WHERE IT IS DRAWN IS THE BUILD'S. `specs/overview.md` hands the layout over, so
// nothing here searches the screen: `controlRegion` asks the build through
// `specs/instrumentation.md`'s `controlRect` and the press lands in the middle of
// the region it named. A build that reports no region for a control it is
// required to draw fails this point, naming what was missing.
//
// ONE CONTROL PER POINT. The `controlRect` table names sixteen controls and each
// is a surface a player presses, so a build where one of them ignores the pointer
// must grade differently from a build where none of them answers. WHAT the
// control does once it acts is decided by the points that drive its own route;
// this one decides only that the press reaches it.
//
// `specs/ui.md` gives the status bar an inventory, a pause and a mute control,
// and `specs/instrumentation.md` names this one `pause`: "The status bar's pause
// control". Its keyboard route is the `pause` action, and `specs/ui.md` says what
// that does from `in-mine` with no panel open: the game reaches `paused`.
//
// ISOLATION. The mine posed through the surface with no panel open, because
// `pause` has a different job while one is: it closes the panel and leaves the
// screen on `in-mine`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  pinMiner,
  standAtCamp,
  type Harness,
} from "../harness";
import { clickRegion, controlRegion } from "./mouse";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the pause menu from the region the status bar reports for it", async () => {
  await openScene(h);
  await layCamp(h);
  await pinMiner(h);
  await pinDrill(h);
  await standAtCamp(h);
  await h.advance(1);

  await clickRegion(h, await controlRegion(h, "pause"));
  await captureStill(h, "paused");

  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "specs/ui.md: the bar's pause control, pressed at its region, opens the pause menu",
  );
});
