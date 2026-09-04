// Meltdown — controls/cancel-control: the panel's Cancel control disarms the
// placement.
//
// specs/hud.md gives the control and its job: "While a placement is armed the panel
// carries two more controls... Cancel | Disarms the placement, clearing the held
// preview." specs/controls.md answers a press and release inside a panel control as
// "That control is operated", and specs/building.md says what disarming leaves
// behind: "Disarming clears the preview entirely", reported as `build` going `null`.
//
// THE CONTROL IS THE ONLY POINTER ROUTE TO CANCELLING. Every other action the panel
// carries has a key beside it, and cancelling has one too — `Escape`, through
// `back`'s first case — but specs/controls.md requires that "Every interaction and
// every menu is reachable with the pointer alone", so a build whose Cancel control
// does nothing leaves a touchscreen player holding a preview they cannot put down.
// `controls.esc-cancels-a-held-placement` reads the key's route, and reads with it
// that cancelling does not also pause; this point reads the control.
//
// THE SCREEN IS READ TOO, for the same reason it is read there: a build that
// disarmed and paused has done something the specification does not ask for, and
// specs/hud.md gives the control one job.
//
// THE RECTANGLE IS THE BUILD'S OWN, and a missing one is a failure rather than a
// null to tolerate: specs/hud.md draws Cancel "only while a preview is held", so a
// scenario holding a preview and finding no Cancel control has found a missing
// control.
//
// THE PREVIEW IS READ BACK BEFORE THE TAP, so a build that never armed at all is
// caught posing rather than passing on a preview it never held. An Arc is held, the
// cheapest emitter in specs/towers.md's table, with the money posed at its build
// cost so nothing here brushes against specs/hud.md's disabled entry, and the
// preview sits on a quiet anchor clear of both vent-to-exhaust corridors.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../constants";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  requireControl,
  startRun,
  tapControl,
  type Harness,
} from "../harness";
import { FREE_SITE } from "../fixtures";

/** The type held: the cheapest emitter in the shop. */
const TYPE = "arc";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("clears the held preview when the reported Cancel rectangle is tapped", async () => {
  await startRun(h);
  await h.debug.setMoney(TOWER_DEFS[TYPE].cost);
  await h.debug.setArmed(TYPE);
  await h.debug.setPreview(FREE_SITE.col, FREE_SITE.row);
  await h.advance(1);
  const before = await h.snapshot();
  assertNotNull(before.build, "the held preview the scenario is posed with");

  await tapControl(
    h,
    requireControl(before, "cancel", "tapping the Cancel control"),
  );
  const after = await h.snapshot();
  await captureStill(h, "cancelled");

  assertNull(
    after.build,
    "the held preview after a press and release inside the reported cancel rectangle",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen after the Cancel control, whose one job is to disarm",
  );
});
