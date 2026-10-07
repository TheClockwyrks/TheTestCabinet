// hud/cooldown-zero-shows-nothing-to-run — a weapon whose timer is 0 shows a
// slot with nothing left to run.
//
// WHERE THE REQUIREMENT COMES FROM. specs/ui.md ("`playing`", the HUD table):
// "Cooldowns | On each weapon's slot, its cooldown state: the slot's picture on
// the tick the weapon fires differs from its picture on the tick before, and a
// weapon whose timer is `0` shows nothing left to run." A slot with nothing
// left to run is a slot that holds still: three ticks of a timer at `0` draw
// one picture, and a slot with a second of cooldown left draws another.
//
// THE WORLD. Two isolated `playing` runs with Taper alone in the first weapon
// slot and EVERY driver switch off, `weaponFire` included: nothing alive,
// nothing on the ground, no passive held, nothing moving. specs/world.md
// ("Timers"): "A timer held by one of the driver switches
// `specs/instrumentation.md` names, a weapon's cooldown timer while
// `weaponFire` is off ... neither counts down nor is due until the switch is on
// again", so the posed timer is the timer every one of the three ticks draws,
// and Taper never fires however long the point runs. The world beneath the slot
// is the empty night with the lamplighter standing still, which draws the same
// on all three ticks, so anything that moves in the slot is the slot's own.
//
// WHAT IS READ. The pixels of Taper's slot, which is the icon's own box grown
// by an icon's width on every side, on three consecutive ticks at a timer of
// `0`, and once more on a fresh run at a timer of `1.0` second. The three at
// `0` must be one picture, which is what nothing left to run means; the one at
// `1.0` must be another, which is what says the state is drawn at all rather
// than the slot never changing.
//
// TOLERANCE. None: the three ticks are read as identical pixels and the
// counting timer as a picture that differs somewhere.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import { DRAWN_POINT_TOLERANCE, FIGURE_TOLERANCE } from "../constants";
import {
  blitCenterOnStage,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  pixelsDiffering,
  type Harness,
} from "../harness";
import { iconBlit, readBox, slotBox } from "./hud";

/** The weapon whose slot is read. */
const WEAPON = "taper";
const LEVEL = 1;

/** The resting timer: nothing left to run. */
const RESTING = 0;

/** The counting timer the resting slot is told from, in seconds. */
const COUNTING = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws one unchanging picture for a timer of 0 and another for a timer of 1", async () => {
  isolate(h);
  const slot = holdWeapon(h, WEAPON, LEVEL);
  h.debug.setWeaponCooldown(slot, RESTING);

  const first = await h.frameDraw();
  const box = slotBox(h, iconBlit(first.blits, WEAPON));
  const center = blitCenterOnStage(h, iconBlit(first.blits, WEAPON));
  const resting = [readBox(h, box)];
  await h.frameDraw();
  resting.push(readBox(h, box));
  await h.frameDraw();
  resting.push(readBox(h, box));
  captureStill(h, "idle");

  const held = h.snapshot();
  assertEqual(held.weaponFire, false, "weaponFire while the slot was read");
  assertWithin(
    held.run.weapons[0].cooldown,
    RESTING,
    FIGURE_TOLERANCE,
    "the timer after three ticks with weaponFire off",
  );

  isolate(h);
  const other = holdWeapon(h, WEAPON, LEVEL);
  h.debug.setWeaponCooldown(other, COUNTING);
  const later = await h.frameDraw();
  const moved = blitCenterOnStage(h, iconBlit(later.blits, WEAPON));
  assertWithin(
    moved.x,
    center.x,
    DRAWN_POINT_TOLERANCE,
    "the x of the slot's icon at a counting timer, against the resting pose",
  );
  assertWithin(
    moved.y,
    center.y,
    DRAWN_POINT_TOLERANCE,
    "the y of the slot's icon at a counting timer, against the resting pose",
  );
  const counting = readBox(h, box);

  assertEqual(
    pixelsDiffering(resting[0], resting[1]),
    0,
    `pixels of ${WEAPON}'s slot differing between the first and second tick at a timer of ${RESTING}`,
  );
  assertEqual(
    pixelsDiffering(resting[1], resting[2]),
    0,
    `pixels of ${WEAPON}'s slot differing between the second and third tick at a timer of ${RESTING}`,
  );
  assertGreaterThan(
    pixelsDiffering(resting[0], counting),
    0,
    `pixels of ${WEAPON}'s slot differing between a timer of ${RESTING} and a timer of ${COUNTING}`,
  );
});
