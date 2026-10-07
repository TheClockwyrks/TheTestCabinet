// panels/inventory-jettison-is-clickable — JETTISON answers a press.
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
// `specs/instrumentation.md` gives `jettison` no subject: it is "The inventory's
// `JETTISON`", which `specs/ui.md` draws "while a Core Sample is carried". So the
// Sample is put in the satchel first, and what the press must do is take it out.
//
// ISOLATION. The camp with the inventory posed open over a carried Sample, so
// nothing but the press can empty the satchel.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "../economy/camp";
import { clickRegion, controlRegion } from "./mouse";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("jettisons the Sample from the region the inventory reports for JETTISON", async () => {
  await openCamp(h);
  await h.debug.setCoreCarried(true);
  await h.debug.setPanel("inventory");
  await h.advance(1);

  const opened = await h.snapshot();
  assertEqual(
    opened.satchel.coreSample,
    true,
    "the Sample carried before the press",
  );

  await clickRegion(h, await controlRegion(h, "jettison"));
  await captureStill(h, "dropped");

  assertEqual(
    (await h.snapshot()).satchel.coreSample,
    false,
    "specs/ui.md: JETTISON, pressed at its region, drops the carried Sample",
  );
});
