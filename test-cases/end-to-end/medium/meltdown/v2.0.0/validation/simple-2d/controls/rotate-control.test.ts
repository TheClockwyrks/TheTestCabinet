// Meltdown — controls/rotate-control: the panel's Rotate control turns the held
// preview.
//
// THE RULE. specs/hud.md gives the control and its job: "While a placement is
// armed the panel carries two more controls... Rotate | Turns the held preview one
// step, as `specs/building.md` states." specs/controls.md answers a press and
// release inside a panel control as "That control is operated", and
// specs/building.md fixes the step: the held rotation "advances... one step
// through `0`, `1`, `2`, `3` and back to `0`".
//
// THE CONTROL AND THE KEY ARE SEPARATE POINTS, because a build can wire one and
// not the other, and specs/controls.md requires BOTH: "Meltdown is built with the
// pointer and driven with the keys beside it. Every interaction and every menu is
// reachable with the pointer alone." A build with a working `KeyR` and no working
// Rotate control cannot be played on a touchscreen at all. `controls.rotate-key`
// reads the key, and reads the wrap with it; this point reads the control.
//
// ONE STEP, FROM ZERO. The arithmetic of the wrap is one rule, read across all
// four starting steps by `controls.rotate-key`; what this point owns is that the
// rectangle the panel reported does the thing at all. Posing rotation `0` outright
// makes the reading `1` rather than a difference, so a build whose control fires
// twice is caught as plainly as one whose control does nothing.
//
// THE RECTANGLE IS THE BUILD'S OWN, and a missing one is a failure rather than a
// null to tolerate: specs/hud.md draws Rotate "only while a preview is held", so a
// scenario that armed a placement and then found no Rotate control has found a
// missing control. `requireControl` says exactly that.
//
// AN ARC IS HELD, because a rotation is only meaningful on a tower with faces to
// turn — specs/towers.md gives movers no rotation — and the money posed clears its
// build cost so nothing here brushes against specs/hud.md's disabled entry. The
// preview sits on a quiet anchor, clear of both vent-to-exhaust corridors.
//
// THE TAP IS A PRESS AND A RELEASE AT THE RECTANGLE'S CENTRE, delivered through
// the ENGINE's own pointer input.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickControl,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { FREE_SITE, heldPreview, requireControl } from "./panel";

/** The type held: the first emitter in the shop, which has faces to turn. */
const TYPE = "arc";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances the held rotation when the reported Rotate rectangle is tapped", async () => {
  startRun(h);
  h.debug.setMoney(TOWER_DEFS[TYPE].cost);
  h.debug.setArmed(TYPE);
  h.debug.setPreview(FREE_SITE.col, FREE_SITE.row);
  h.debug.setPreviewRotation(0);
  await h.advance(1);
  assertEqual(
    heldPreview(h, "posing the preview before the tap").rotation,
    0,
    "posing: the held rotation the scenario is posed at (specs/building.md)",
  );

  await clickControl(
    h,
    requireControl(h.snapshot(), "rotate", "tapping the Rotate control"),
  );
  captureStill(h, "rotated");

  assertEqual(
    heldPreview(h, "after the Rotate control was tapped").rotation,
    1,
    "the held rotation after a press and release inside the reported rotate " +
      "rectangle, from 0 (specs/hud.md, specs/building.md)",
  );
});
