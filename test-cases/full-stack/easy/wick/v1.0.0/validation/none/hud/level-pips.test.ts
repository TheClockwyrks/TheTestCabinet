// hud/level-pips — a held item's slot shows one pip per level it holds.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Weapon slots |
// `WEAPON_SLOTS` (`6`) slots in slot order, each held weapon as its icon with one
// pip per level held, the pips in a row outside the square the icon is drawn in
// and the only marks that row gains over a slot holding nothing, and an empty
// slot visibly empty, drawing neither icon nor pip", and "Passive slots |
// `PASSIVE_SLOTS` (`6`) slots, the same way". `specs/assets.md` puts the pips
// among what the build draws in code, so nothing here looks for a produced file.
//
// HOW PIPS ARE COUNTED WITHOUT KNOWING WHAT ONE LOOKS LIKE. `specs/ui.md` fixes
// no palette and no styling and leaves each screen's layout to the build except
// where the table places one element against another, so a pip is not looked
// for: two frames are drawn a pose apart with nothing else changed, and the
// marks the pose added are the connected regions of pixels the two frames differ
// on. The icon, the slot, the bars, the clock, and the world are the same in
// both, so what is left is what the pose drew.
//
// WHERE THE PIP ROW IS. The row's place is the build's, so it is read rather
// than looked for: raising Taper from `1` to `5` adds pips and nothing else, the
// added pips lie in the row, and the rows those marks span ARE the row. Every
// count below is taken inside that band.
//
// WHY THE COUNT IS ABSOLUTE. Against a level a slot already holds, a build that
// draws one pip per level GAINED rather than per level HELD adds exactly the
// marks a conformant one does, so a difference between two levels decides
// nothing about the number a slot shows. The count is therefore taken against
// the frame in which that slot HOLDS NOTHING, which the row now defines: an
// empty slot draws "neither icon nor pip", and the pips are "the only marks that
// row gains over a slot holding nothing". So the marks the row gains when a slot
// fills are the slot's pips, exactly, and a slot holding `k` levels shows `k` of
// them. Everything a slot draws in both states still cancels — the slot's frame,
// a rail, a full set of dimmed placeholder pips lit `k` at a time — and every
// mark a build adds outside the row is outside the reading.
//
// The difference between the two levels is read as well as the absolute count,
// because the two fail differently: a slot whose picture does not change with
// the level fails the first, and a slot showing the wrong NUMBER of pips fails
// the second.
//
// THE FIGURES. `MAX_WEAPON_LEVEL` (`8`) is Taper's ceiling (specs/weapons.md) and
// `5` is inside it; Brass's `maxLevel` is `3` in `PASSIVES` (specs/passives.md),
// so `3` is its ceiling. Both slots are read because the specification states the
// rule for a weapon slot and then extends it to the passive slots. Each slot is
// counted against the frame in which THAT slot held nothing, so Brass is read
// against the frame Taper is already held on and Taper's own pips cancel.
//
// THE TOLERANCE. `MARK_MIN_AREA`, two pixels: a mark a player counts at a glance
// is larger than that, and the single pixel an antialiased edge leaves is not a
// mark. There is no tolerance on the counts themselves: "one pip per level held"
// is exact, so five levels held must show five marks and four levels added must
// add four.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  type Harness,
} from "../harness";
import {
  differenceMask,
  markBandIn,
  marksIn,
  wholeOf,
  MARK_MIN_AREA,
  type Mask,
  type Rect,
} from "./regions";
import { drawnPixels, poseNight } from "./stage";

/** The levels Taper is read at, and the pips the rise between them adds. */
const TAPER_LOW = 1;
const TAPER_HIGH = 5;

/** The levels Brass is read at: its own ceiling in `PASSIVES` is `3`. */
const BRASS_LOW = 1;
const BRASS_HIGH = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows one pip in a slot's pip row for each level the item holds", async () => {
  await poseNight(h);
  const nothingHeld = await drawnPixels(h);

  const slot = await holdWeapon(h, "taper", TAPER_LOW);
  const taperLow = await drawnPixels(h);
  await h.debug.setWeapon(slot, "taper", TAPER_HIGH);
  const taperHigh = await drawnPixels(h);

  const passive = await holdPassive(h, "brass", BRASS_LOW);
  const brassLow = await drawnPixels(h);
  await h.debug.setPassive(passive, "brass", BRASS_HIGH);
  const brassHigh = await drawnPixels(h);
  await captureStill(h, "pips");

  const marksOf = (mask: Mask, row?: Rect): number =>
    marksIn(mask, row ?? wholeOf(mask), MARK_MIN_AREA);

  const taperRise = differenceMask(taperLow, taperHigh);
  assertEqual(
    marksOf(taperRise),
    TAPER_HIGH - TAPER_LOW,
    `the marks Taper's slot gained between level ${TAPER_LOW} and level ${TAPER_HIGH}`,
  );
  const taperRow = markBandIn(taperRise, wholeOf(taperRise), MARK_MIN_AREA);
  assertEqual(
    marksOf(differenceMask(nothingHeld, taperHigh), taperRow),
    TAPER_HIGH,
    `the pips in Taper's pip row at level ${TAPER_HIGH}, against the slot holding nothing`,
  );
  assertEqual(
    marksOf(differenceMask(nothingHeld, taperLow), taperRow),
    TAPER_LOW,
    `the pips in Taper's pip row at level ${TAPER_LOW}, against the slot holding nothing`,
  );

  const brassRise = differenceMask(brassLow, brassHigh);
  assertEqual(
    marksOf(brassRise),
    BRASS_HIGH - BRASS_LOW,
    `the marks Brass's slot gained between level ${BRASS_LOW} and level ${BRASS_HIGH}`,
  );
  const brassRow = markBandIn(brassRise, wholeOf(brassRise), MARK_MIN_AREA);
  assertEqual(
    marksOf(differenceMask(taperHigh, brassHigh), brassRow),
    BRASS_HIGH,
    `the pips in Brass's pip row at level ${BRASS_HIGH}, against the slot holding nothing`,
  );
  assertEqual(
    marksOf(differenceMask(taperHigh, brassLow), brassRow),
    BRASS_LOW,
    `the pips in Brass's pip row at level ${BRASS_LOW}, against the slot holding nothing`,
  );
});
