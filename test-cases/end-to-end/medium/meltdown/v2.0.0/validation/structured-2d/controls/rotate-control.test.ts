// Meltdown — controls/rotate-control: the panel's Rotate control turns the held
// preview.
//
// THE RULE. specs/hud.md gives the control and its job: "While a placement is
// armed the panel carries two more controls... Rotate | Turns the held preview one
// step, as `specs/building.md` states." specs/controls.md answers a press and
// release inside a panel control as "That control is operated", and
// specs/building.md fixes the step: the held rotation "advances... one step through
// `0`, `1`, `2`, `3` and back to `0`".
//
// THE CONTROL AND THE KEY ARE SEPARATE ITEMS, because a build can wire one and not
// the other, and specs/controls.md requires BOTH: "Meltdown is built with the
// pointer and driven with the keys beside it. Every interaction and every menu is
// reachable with the pointer alone." A build with a working KeyR and no working
// Rotate control cannot be played on a touchscreen at all. `controls.rotate-key`
// reads the key, and reads the wrap with it; this item reads the control.
//
// ONE STEP, FROM ZERO. The arithmetic of the wrap is one rule, read across all four
// starting steps by `controls.rotate-key`; what this item owns is that the
// rectangle the panel reported does the thing at all. Posing rotation `0` outright
// makes the reading `1` rather than a difference, so a build whose control fires
// twice is caught as plainly as one whose control does nothing.
//
// THE RECTANGLE IS THE BUILD'S OWN, and a missing one is a failure rather than a
// null to tolerate: specs/hud.md draws Rotate "only while a preview is held", so a
// scenario that armed a placement and found no Rotate control has found a missing
// control.
//
// AN ARC IS HELD, because a rotation is only meaningful on a tower with faces to
// turn — specs/towers.md gives movers no rotation — and the money posed clears its
// build cost so nothing here brushes against specs/hud.md's disabled entry. The
// preview sits on a quiet anchor, clear of both vent-to-exhaust corridors.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TOWER_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  tapControl,
  type Harness,
} from "../harness";
import { QUIET_SITE, requireControl } from "./scene";

/** The type held: the first emitter in the shop, which has faces to turn. */
const TYPE = "arc";

/** Money at the held type's build cost, so its shop entry is not the disabled one. */
const PURSE = TOWER_DEFS[TYPE].cost;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances the held rotation when the reported Rotate rectangle is tapped", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  h.debug.setArmed(TYPE);
  h.debug.setPreview(QUIET_SITE.col, QUIET_SITE.row);
  h.debug.setPreviewRotation(0);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(
    before.build?.rotation,
    0,
    "the held rotation the scenario is posed at",
  );

  await tapControl(
    h,
    requireControl(before, "rotate", "tapping the Rotate control"),
  );
  captureStill(h, "rotated");

  assertEqual(
    h.snapshot().build?.rotation,
    1,
    "the held rotation after a press and release inside the reported rotate rectangle, from 0",
  );
});
