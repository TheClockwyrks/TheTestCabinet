// hud/level-pips — a held item's slot shows one pip per level.
//
// WHERE THE REQUIREMENT COMES FROM. specs/ui.md ("`playing`", the HUD table):
// "Weapon slots | `WEAPON_SLOTS` (`6`) slots in slot order, each held weapon as
// its icon with one pip per level held", and "Passive slots | `PASSIVE_SLOTS`
// (`6`) slots, the same way". Taper runs to `MAX_WEAPON_LEVEL` (`8`)
// (specs/weapons.md), so its slot is read at levels 1, 3, and 5; Brass's
// `maxLevel` in `PASSIVES` is 3 (specs/passives.md), so its slot is read at
// levels 1, 2, and 3.
//
// THE WORLD. Six isolated `playing` runs, each posed through `isolate`, which
// resets first: nothing alive, nothing on the ground, every driver switch off,
// and ONE item held. `weaponFire` is off, so Taper's cooldown timer neither
// counts nor is due (specs/world.md, "Timers") and every pose draws its slot at
// the same resting timer, which leaves the level as the only thing between two
// of its frames. Only one item is held in each run, so a slot read wider than
// its icon takes in neighbors that are empty and identical across the poses.
//
// WHAT IS READ. The pixels of the slot, which is the icon's own box grown by an
// icon's width on every side, at each posed level; then how many of them differ
// between one level and another. Reading a COUNT of pips off a picture takes
// the area the levels do not share rather than a count of marks, since
// specs/ui.md fixes no arrangement for the pips: a slot at level `k` and the
// same slot at level `1` differ over `k - 1` marks whether the row grows right,
// grows left, or grows out from its middle, as long as both counts are odd. So
// levels 1, 3, and 5 owe exactly twice the difference at 5 that they owe at 3,
// which is what a build showing one pip per level produces and what a build
// spelling the level out as a numeral does not.
//
// WHY BRASS IS READ DIFFERENTLY. Its `maxLevel` is 3, so its odd levels are 1
// and 3 alone and no ratio can be taken. What a passive's slot is held to is
// that every one of its levels shows: its three levels draw three pictures, no
// two alike.
//
// TOLERANCE. PIP_RATIO_TOLERANCE, two fifths of one mark, which admits the edge
// pixels of a mark and refuses a slot that ignores its level.

import type { Canvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import {
  DRAWN_POINT_TOLERANCE,
  type OfferId,
  type PassiveId,
  type WeaponId,
} from "../constants";
import {
  blitCenterOnStage,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  pixelsDiffering,
  type Harness,
  type PixelRect,
} from "../harness";
import {
  PIP_RATIO_TOLERANCE,
  captureFrames,
  iconBlit,
  keepFrame,
  readBox,
  slotBox,
  type Box,
} from "./hud";

/** The weapon whose slot the count law is read on, and its three levels. */
const WEAPON: WeaponId = "taper";
const WEAPON_LEVELS = [1, 3, 5] as const;

/** The passive whose slot every level must show in, and its three levels. */
const PASSIVE: PassiveId = "brass";
const PASSIVE_LEVELS = [1, 2, 3] as const;

/** One posed level: the slot's pixels, and the whole frame as evidence. */
interface Posed {
  slot: PixelRect;
  frame: Canvas;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Pose `id` alone at `level`, draw one frame, and read the slot it took.
 *
 * `box` fixes the rectangle read after the first pose, so every level of one
 * item is read over the same pixels; the icon's center is checked against the
 * box's own so a slot that moved is reported rather than compared.
 */
async function poseSlot(
  id: OfferId,
  level: number,
  hold: (level: number) => void,
  box: Box | null,
): Promise<Posed & { box: Box }> {
  isolate(h);
  hold(level);

  const { blits } = await h.frameDraw();
  const blit = iconBlit(blits, id);
  const read = box ?? slotBox(h, blit);
  const center = blitCenterOnStage(h, blit);
  assertWithin(
    center.x,
    read.x + read.w / 2,
    DRAWN_POINT_TOLERANCE,
    `the x of ${id}'s icon at level ${level}, against the slot read`,
  );
  assertWithin(
    center.y,
    read.y + read.h / 2,
    DRAWN_POINT_TOLERANCE,
    `the y of ${id}'s icon at level ${level}, against the slot read`,
  );
  return { slot: readBox(h, read), frame: keepFrame(h), box: read };
}

it("draws one pip per level in a weapon's slot and shows every level of a passive", async () => {
  let box: Box | null = null;
  const weapon: Posed[] = [];
  for (const level of WEAPON_LEVELS) {
    const posed = await poseSlot(
      WEAPON,
      level,
      (at) => {
        holdWeapon(h, WEAPON, at);
      },
      box,
    );
    box = posed.box;
    weapon.push(posed);
  }

  box = null;
  const passive: Posed[] = [];
  for (const level of PASSIVE_LEVELS) {
    const posed = await poseSlot(
      PASSIVE,
      level,
      (at) => {
        holdPassive(h, PASSIVE, at);
      },
      box,
    );
    box = posed.box;
    passive.push(posed);
  }

  captureFrames([weapon[0].frame, weapon[2].frame, passive[2].frame], "pips");

  const three = pixelsDiffering(weapon[0].slot, weapon[1].slot);
  const five = pixelsDiffering(weapon[0].slot, weapon[2].slot);
  assertGreaterThan(
    three,
    0,
    `pixels of ${WEAPON}'s slot differing between level 1 and level 3`,
  );
  assertWithin(
    five / three,
    2,
    PIP_RATIO_TOLERANCE,
    `the marks ${WEAPON}'s slot adds by level 5 against the marks it adds by level 3`,
  );

  PASSIVE_LEVELS.forEach((level, at) => {
    PASSIVE_LEVELS.slice(at + 1).forEach((other, ahead) => {
      assertGreaterThan(
        pixelsDiffering(passive[at].slot, passive[at + 1 + ahead].slot),
        0,
        `pixels of ${PASSIVE}'s slot differing between level ${level} and level ${other}`,
      );
    });
  });
  assertEqual(
    h.snapshot().weaponFire,
    false,
    "weaponFire while the slots were read",
  );
});
