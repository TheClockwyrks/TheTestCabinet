// panels/launch-pad-launch-is-clickable — LAUNCH answers a press.
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
// ISOLATION. The pad with its panel posed open and all five components already
// installed through the surface, so the only thing left for the press to do is
// the launch itself. Whether the launch WINS is `rocket/launch-wins`' point; this
// one reads that the rocket left the pad at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ROCKET_COMPONENT_IDS } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { openPadScene, runUntilScreenLeaves } from "../rocket/pad-scene";
import { clickRegion, controlRegion } from "./mouse";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("launches from the region the Launch Pad reports for LAUNCH", async () => {
  openPadScene(h);
  h.debug.setRocketInstalled(ROCKET_COMPONENT_IDS.length);
  await h.advance(1);

  const flown = await captureReplay(h, "launched", async () => {
    await clickRegion(h, controlRegion(h, "launch"));
    return runUntilScreenLeaves(h, "in-mine");
  });

  assertEqual(
    flown.screen,
    "victory",
    "specs/ui.md: LAUNCH, pressed at its region, launches the rocket",
  );
});
