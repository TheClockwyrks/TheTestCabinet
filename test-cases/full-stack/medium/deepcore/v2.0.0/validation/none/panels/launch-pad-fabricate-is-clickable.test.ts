// panels/launch-pad-fabricate-is-clickable — FABRICATE answers a press.
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
// ISOLATION. The pad with its panel posed open, both materials and the Core
// Sample carried, and Credits enough for the first component alone, so what the
// press moves is the checklist rather than the balance's headroom.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { ROCKET_COMPONENTS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openPadScene } from "../rocket/pad-scene";
import { clickRegion, controlRegion } from "./mouse";

/** The first component the pad offers, and what it costs. */
const FIRST = ROCKET_COMPONENTS[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fabricates from the region the Launch Pad reports for FABRICATE", async () => {
  await openPadScene(h);
  await h.debug.setCredits(FIRST.credits);
  await h.debug.setMaterial("resonite", 1);
  await h.debug.setMaterial("cryenite", 1);
  await h.debug.setCoreCarried(true);
  await h.advance(1);

  const opened = await h.snapshot();
  assertLength(opened.rocket.installed, 0, "nothing built before the press");

  await clickRegion(h, await controlRegion(h, "fabricate"));
  await captureStill(h, "built");

  const built = await h.snapshot();
  assertLength(
    built.rocket.installed,
    1,
    "specs/ui.md: FABRICATE, pressed at its region, builds the next component",
  );
  assertEqual(
    built.rocket.installed[0],
    FIRST.id,
    "specs/rocket.md: the component the checklist offered",
  );
});
