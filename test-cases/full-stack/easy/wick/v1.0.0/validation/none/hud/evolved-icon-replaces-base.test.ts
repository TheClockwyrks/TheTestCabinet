// hud/evolved-icon-replaces-base — an evolved weapon's icon stands in its slot
// where its base's stood.
//
// THE REQUIREMENT. `specs/assets.md` — "The icons": "an evolved weapon's icon is
// shown in its slot and on the chest overlay's evolve result, and never in an
// offer", over `specs/ui.md`'s "each held weapon as its icon". This point decides
// the slot.
//
// WHY THE SLOT IS POSED RATHER THAN EVOLVED INTO. `specs/evolutions.md` —
// "Opening a chest": "The evolved weapon replaces its base in the same slot with
// a single level", so a slot holding `pyre` at level `1` is exactly the loadout
// an evolution leaves, and `setWeapon` reaches it in one operation.
// A validator drives nothing outside the requirement it decides: whether a chest
// evolves Taper at all is the evolutions points' business, and a build with a
// broken chest and a right HUD must fail those and pass this.
//
// WHAT IS READ. `specs/assets.md` gives every item its own produced `24 x 24`
// icon file, resolved through the bundler, which inlines a small PNG as a `data:`
// URI — so an icon is recognized by the source drawn and never by a path. Taper's
// icon is named by holding Taper alone; Pyre's by holding Pyre alone in the same
// slot. The two must be different sources, drawn in the same place: that is the
// whole of "the evolved icon rather than the base's".
//
// THE TOLERANCE. `BLIT_TOL`, one unit, on where the icon sits: both frames are
// the same build drawing the same slot, and a build is free to round a position
// to the pixel grid.

import { afterEach, beforeEach, it } from "vitest";
import { BLIT_TOL } from "../constants";
import { assertEqual, assertLessThanOrEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  type Harness,
} from "../harness";
import { iconDraws, iconKey } from "./readouts";
import { drawnCalls, poseNight } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the evolved weapon's icon in the slot its base held", async () => {
  await poseNight(h);
  const slot = await holdWeapon(h, "taper", 1);
  const base = iconDraws(await drawnCalls(h));
  assertEqual(base.length, 1, "the icons drawn with Taper held alone");

  await h.debug.removeWeapon(slot);
  await h.debug.setWeapon(slot, "pyre", 1);
  const evolved = iconDraws(await drawnCalls(h));
  await captureStill(h, "icon");

  assertEqual(evolved.length, 1, "the icons drawn with Pyre held alone");
  const from = base[0]!;
  const to = evolved[0]!;
  assertLessThanOrEqual(
    Math.hypot(to.cx - from.cx, to.cy - from.cy),
    BLIT_TOL,
    "how far Pyre's icon sits from where Taper's stood, in units",
  );
  assertNotEqual(
    iconKey(to),
    iconKey(from),
    "the icon the first weapon slot draws once the slot holds Pyre",
  );
});
