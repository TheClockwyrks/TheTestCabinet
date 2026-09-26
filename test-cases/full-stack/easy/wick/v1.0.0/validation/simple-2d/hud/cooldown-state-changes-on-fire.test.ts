// hud/cooldown-state-changes-on-fire — a weapon's slot changes on the tick it
// fires.
//
// WHERE THE REQUIREMENT COMES FROM. specs/ui.md ("`playing`", the HUD table):
// "Cooldowns | On each weapon's slot, its cooldown state: the slot's picture on
// the tick the weapon fires differs from its picture on the tick before, and a
// weapon whose timer is `0` shows nothing left to run."
//
// THE WORLD. An isolated `playing` run with Taper alone in the first weapon
// slot and `weaponFire` the only switch on: nothing alive, nothing on the
// ground, no passive held, nothing moving, nothing hitting. Taper needs no
// target (specs/weapons.md, "Cooldown timers"), so it fires against an empty
// night, and the two frames the point compares are the same night drawn two
// ticks apart with the cooldown state the only thing between them.
//
// WHY THE TIMER IS POSED TWO TICKS OUT. specs/world.md ("Timers"): "a timer set
// to `s` seconds is due `round(s × TICK_HZ)` ticks after the tick it was set
// on". Posed at `2 × TICK_DT` the timer is due on the SECOND tick after the
// pose, so the first frame is a tick on which the timer counted and nothing
// fired, and the second is the tick Taper fires on. specs/world.md ("One tick")
// fires in phase 5 and the frame draws what the tick left, so the second frame
// is the firing tick's own picture. Each frame reads the zones back to say
// which tick it was.
//
// WHAT IS READ. The pixels of Taper's slot, which is the icon's own box grown
// by an icon's width on every side, on the two ticks, and how many of them
// differ. The slot alone is read rather than the frame, because the firing tick
// also puts a slash in the world; the point checks first that the slot is drawn
// clear of the stage the slash is drawn on, and fails naming that when it is
// not, since a slot drawn over the lamplighter cannot be told from the effect
// under it.
//
// TOLERANCE. None: the requirement is that the two pictures differ, and a
// picture either differs somewhere or does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { STAGE_CX, STAGE_CY, TAPER_LEVELS, TICK_DT } from "../constants";
import {
  createHarness,
  enable,
  holdWeapon,
  isolate,
  pixelsDiffering,
  zonesOfKind,
  type Harness,
} from "../harness";
import {
  captureFrames,
  iconBlit,
  keepFrame,
  overlaps,
  readBox,
  slotBox,
  type Box,
} from "./hud";

/** The weapon read, at the level whose slash the exclusion below is sized on. */
const WEAPON = "taper";
const LEVEL = 1;

/** Ticks between the pose and the tick the timer is due on. */
const DUE_IN = 2;

/**
 * The stage the slash is drawn on, which Taper's slot must sit clear of.
 *
 * specs/weapons.md ("Taper"): a slash's "near vertical edge is at the player's
 * `x`, it extends `width` in the facing direction, and it is centered
 * vertically on the player's `y`", and specs/ui.md draws the lamplighter "at
 * the stage center `(STAGE_CX, STAGE_CY)`". So the slash covers a `width` to
 * either side of the center and a `height` about it, and the box below adds a
 * `height` of margin for whatever flourish a build draws its flash with.
 */
const SLASH: Box = {
  x:
    STAGE_CX - (TAPER_LEVELS[LEVEL - 1].width + TAPER_LEVELS[LEVEL - 1].height),
  y: STAGE_CY - TAPER_LEVELS[LEVEL - 1].height * 1.5,
  w: 2 * (TAPER_LEVELS[LEVEL - 1].width + TAPER_LEVELS[LEVEL - 1].height),
  h: TAPER_LEVELS[LEVEL - 1].height * 3,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws Taper's slot differently on the tick it fires", async () => {
  isolate(h);
  const slot = holdWeapon(h, WEAPON, LEVEL);
  h.debug.setWeaponCooldown(slot, DUE_IN * TICK_DT);
  enable(h, "weaponFire");

  const before = await h.frameDraw();
  const box = slotBox(h, iconBlit(before.blits, WEAPON));
  if (overlaps(box, SLASH)) {
    fail(
      `${WEAPON}'s slot drawn clear of the stage its slash is drawn on ` +
        `(x ${SLASH.x} to ${SLASH.x + SLASH.w}, y ${SLASH.y} to ${SLASH.y + SLASH.h})`,
      `a slot at x ${box.x} to ${box.x + box.w}, y ${box.y} to ${box.y + box.h}`,
    );
  }
  const waiting = readBox(h, box);
  const waitingFrame = keepFrame(h);
  const counting = h.snapshot();

  await h.frameDraw();
  const firing = readBox(h, box);
  const firingFrame = keepFrame(h);
  const fired = h.snapshot();
  captureFrames([waitingFrame, firingFrame], "fire");

  assertEqual(
    zonesOfKind(counting, "slash").length,
    0,
    "slashes on the tick before the timer was due",
  );
  assertEqual(
    zonesOfKind(fired, "slash").length,
    TAPER_LEVELS[LEVEL - 1].amount,
    "slashes on the tick the timer was due",
  );
  assertGreaterThan(
    pixelsDiffering(waiting, firing),
    0,
    `pixels of ${WEAPON}'s slot differing between the tick before it fired and the tick it fired`,
  );
});
