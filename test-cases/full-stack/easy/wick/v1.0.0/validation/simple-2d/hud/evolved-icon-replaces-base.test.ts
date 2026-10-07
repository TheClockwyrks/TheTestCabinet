// hud/evolved-icon-replaces-base — an evolved weapon's slot draws its own icon
// and not its base's.
//
// WHERE THE REQUIREMENT COMES FROM. specs/evolutions.md ("What an evolution
// is"): "On the HUD the slot shows the evolved weapon's icon in place of the
// base weapon's", with "The base weapon it replaced is gone from the loadout".
// specs/assets.md ("The icons") fixes the two pictures: "Each is one `24 x 24`
// sprite at `assets/icons/<id>.png`", and "an evolved weapon's icon is shown in
// its slot and on the chest overlay's evolve result". Taper's evolved form is
// Pyre (specs/evolutions.md, "The recipe"), so the first weapon slot owes
// `icons/pyre.png` and owes no `icons/taper.png`.
//
// THE WORLD. Two isolated `playing` runs, each posed through `isolate`, which
// resets first: nothing alive, nothing on the ground, no passive held, every
// driver switch off. The first holds Taper at `MAX_WEAPON_LEVEL`, the level it
// would evolve from, in the first weapon slot; the second holds Pyre at level
// 1, which is what an evolution leaves there, "The evolved weapon replaces its
// base in the same slot with a single level". The loadout is posed rather than
// reached through a chest, because a chest, its collection, and the recipe are
// each decided by points of their own: what this point decides is what the SLOT
// draws once the evolved weapon is the weapon held.
//
// WHAT IS READ. Which produced icon each frame blitted, and where. The Pyre
// frame must blit `icons/pyre.png` and must not blit `icons/taper.png`, and the
// two icons must land on the same slot, so the reading is of a replacement in
// place rather than of a second slot opening beside the first.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE on where the two icons land, one unit, which
// is what a build that snaps a slot's picture to whole device pixels may move
// by. The icons themselves are files the frame either blitted or did not.

import { afterEach, beforeEach, it } from "vitest";
import { assertFalse, assertTrue, assertWithin } from "../assert";
import { DRAWN_POINT_TOLERANCE, MAX_WEAPON_LEVEL } from "../constants";
import {
  blitCenterOnStage,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";
import { drewIcon, iconBlit } from "./hud";

/** The base weapon, and the evolved form that replaces it. */
const BASE = "taper";
const EVOLVED = "pyre";

/** The first weapon slot, the one both are posed into. */
const SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws Pyre's icon and not Taper's in the slot Pyre is held in", async () => {
  isolate(h);
  h.debug.setWeapon(SLOT, BASE, MAX_WEAPON_LEVEL);
  const before = await h.frameDraw();
  const base = blitCenterOnStage(h, iconBlit(before.blits, BASE));

  isolate(h);
  h.debug.setWeapon(SLOT, EVOLVED, 1);
  const after = await h.frameDraw();
  captureStill(h, "icon");

  assertTrue(
    drewIcon(after.blits, EVOLVED),
    `the frame holding ${EVOLVED} in slot ${SLOT} drew its produced icon`,
  );
  assertFalse(
    drewIcon(after.blits, BASE),
    `the frame holding ${EVOLVED} in slot ${SLOT} drew ${BASE}'s produced icon`,
  );

  const evolved = blitCenterOnStage(h, iconBlit(after.blits, EVOLVED));
  assertWithin(
    evolved.x,
    base.x,
    DRAWN_POINT_TOLERANCE,
    `the x of ${EVOLVED}'s icon, against where ${BASE}'s was drawn`,
  );
  assertWithin(
    evolved.y,
    base.y,
    DRAWN_POINT_TOLERANCE,
    `the y of ${EVOLVED}'s icon, against where ${BASE}'s was drawn`,
  );
});
