// hud/level-pips — a held item's slot shows one pip per level.
//
// WHERE THE REQUIREMENT COMES FROM. specs/ui.md ("`playing`", the HUD table):
// "Weapon slots | `WEAPON_SLOTS` (`6`) slots in slot order, each held weapon as
// its icon with one pip per level held, the pips in a row outside the square
// the icon is drawn in and the only marks that row gains over a slot holding
// nothing, and an empty slot visibly empty, drawing neither icon nor pip", and
// "Passive slots | `PASSIVE_SLOTS` (`6`) slots, the same way". Taper runs to
// `MAX_WEAPON_LEVEL` (`8`) (specs/weapons.md), so its slot is read at levels 1,
// 3, and 5; Brass's `maxLevel` in `PASSIVES` is 3 (specs/passives.md), so its
// slot is read at levels 1, 2, and 3.
//
// THE WORLD. Seven isolated `playing` runs, each posed through `isolate`, which
// resets first: nothing alive, nothing on the ground, every driver switch off,
// and ONE item held or none at all. `weaponFire` is off, so Taper's cooldown
// timer neither counts nor is due (specs/world.md, "Timers") and every pose
// draws its slot at the same resting timer, which leaves the level as the only
// thing between two of its frames. Only one item is held in each run, so a slot
// read wider than its icon takes in neighbors that are empty and identical
// across the poses, and the seventh run holds nothing at all, which is the slot
// the counts are taken against.
//
// WHAT IS READ, FIRST. The pixels of the slot, which is the icon's own box
// grown by an icon's width on every side, at each posed level; then how many of
// them differ between one level and another. The area two levels do not share
// is `k - 1` marks whether the row grows right, grows left, or grows out from
// its middle, as long as both counts are odd, so levels 1, 3, and 5 owe exactly
// twice the difference at 5 that they owe at 3.
//
// WHAT IS READ, SECOND. The COUNT itself, which the row clause makes readable.
// The marks the level 1 slot and the level 5 slot do not share are pips, and
// they sit in one row, so the rows they span locate the pip row without the
// specification saying where on the slot it falls. Against the slot holding
// nothing, that row gains nothing but pips, so the marks of the empty-to-level
// difference lying in it are the pips themselves: one at level 1 and five at
// level 5 for Taper, three at level 3 for Brass. The icon's own square is
// cleared from the difference before the row is located and before the marks
// are counted, because the specification puts the pips OUTSIDE it and a build
// may draw its row beside the icon rather than under it.
//
// WHY BRASS IS READ DIFFERENTLY FOR THE RATIO. Its `maxLevel` is 3, so its odd
// levels are 1 and 3 alone and no ratio can be taken. What a passive's slot is
// held to there is that every one of its levels shows: its three levels draw
// three pictures, no two alike.
//
// TOLERANCE. PIP_RATIO_TOLERANCE, two fifths of one mark, on the ratio. On the
// count itself there is no tolerance, because a count is a whole number;
// MARK_MIN_AREA, two pixels, decides what a mark is, which is below any pip a
// player counts at a glance and above the single pixel an antialiased edge
// leaves.

import type { Canvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin, fail } from "../assert";
import {
  DRAWN_POINT_TOLERANCE,
  type OfferId,
  type PassiveId,
  type WeaponId,
} from "../constants";
import {
  blitBoxOnStage,
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
  MARK_MIN_AREA,
  PIP_RATIO_TOLERANCE,
  captureFrames,
  differenceMask,
  iconBlit,
  keepFrame,
  marksInRows,
  pixelBoxOf,
  readBox,
  rowSpanOf,
  slotBox,
  withoutBox,
  type Box,
  type PixelBox,
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
 * box's own so a slot that moved is reported rather than compared. `icon` is
 * where the icon's own square fell inside that rectangle, which is the part of
 * the slot the pips are drawn outside of.
 */
async function poseSlot(
  id: OfferId,
  level: number,
  hold: (level: number) => void,
  box: Box | null,
): Promise<Posed & { box: Box; icon: PixelBox }> {
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
  return {
    slot: readBox(h, read),
    frame: keepFrame(h),
    box: read,
    icon: pixelBoxOf(h, read, blitBoxOnStage(h, blit)),
  };
}

/** Draw one frame with nothing held and read the same rectangle `box` names. */
async function poseNothing(box: Box): Promise<PixelRect> {
  isolate(h);
  await h.frameDraw();
  return readBox(h, box);
}

/**
 * How many pips the slot drew at `level`, against the same slot holding
 * nothing: the marks the pip row gained, the icon's own square cleared first.
 *
 * The row is located from the two levels the caller hands in, whose difference
 * is pips alone, and the count is taken over the empty slot in that row, where
 * specs/ui.md says pips are the only marks a filled slot adds.
 */
function pipsDrawn(
  empty: PixelRect,
  low: PixelRect,
  high: PixelRect,
  posed: PixelRect,
  icon: PixelBox,
  what: string,
): number {
  const row = rowSpanOf(withoutBox(differenceMask(low, high), icon));
  if (row === null) {
    fail(`a pip row ${what} adds marks to between the two levels read`, "none");
  }
  return marksInRows(
    withoutBox(differenceMask(empty, posed), icon),
    row,
    MARK_MIN_AREA,
  );
}

it("draws one pip per level in a weapon's slot and shows every level of a passive", async () => {
  let box: Box | null = null;
  let icon: PixelBox | null = null;
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
    icon = posed.icon;
    weapon.push(posed);
  }
  const weaponBox = box as Box;
  const weaponIcon = icon as PixelBox;
  const weaponEmpty = await poseNothing(weaponBox);

  box = null;
  icon = null;
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
    icon = posed.icon;
    passive.push(posed);
  }
  const passiveEmpty = await poseNothing(box as Box);
  const passiveIcon = icon as PixelBox;

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

  const weaponPips = (at: number): number =>
    pipsDrawn(
      weaponEmpty,
      weapon[0].slot,
      weapon[2].slot,
      weapon[at].slot,
      weaponIcon,
      `${WEAPON}'s slot`,
    );
  assertEqual(
    weaponPips(0),
    WEAPON_LEVELS[0],
    `pips in ${WEAPON}'s pip row at level ${WEAPON_LEVELS[0]}, against its slot holding nothing`,
  );
  assertEqual(
    weaponPips(2),
    WEAPON_LEVELS[2],
    `pips in ${WEAPON}'s pip row at level ${WEAPON_LEVELS[2]}, against its slot holding nothing`,
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
    pipsDrawn(
      passiveEmpty,
      passive[0].slot,
      passive[2].slot,
      passive[2].slot,
      passiveIcon,
      `${PASSIVE}'s slot`,
    ),
    PASSIVE_LEVELS[2],
    `pips in ${PASSIVE}'s pip row at level ${PASSIVE_LEVELS[2]}, against its slot holding nothing`,
  );
  assertEqual(
    h.snapshot().weaponFire,
    false,
    "weaponFire while the slots were read",
  );
});
