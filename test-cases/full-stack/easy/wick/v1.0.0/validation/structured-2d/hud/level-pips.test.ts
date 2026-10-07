// hud/level-pips — a held item's slot carries one pip per level held.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Weapon slots |
// `WEAPON_SLOTS` (`6`) slots in slot order, each held weapon as its icon with
// one pip per level held, the pips in a row outside the square the icon is
// drawn in and the only marks that row gains over a slot holding nothing, and an
// empty slot visibly empty, drawing neither icon nor pip", and "Passive slots |
// `PASSIVE_SLOTS` (`6`) slots, the same way."
//
// THE FIGURES, AND WHERE THEY COME FROM. `specs/progression.md` levels a base
// weapon to `MAX_WEAPON_LEVEL` (`8`) and a passive to its own max, and
// `specs/passives.md` gives Brass a max of `3`, so Taper at `5` and Brass at `3`
// are levels a run reaches. One pip per level makes Taper's slot carry five,
// Taper at level `1` one, and Brass's three.
//
// HOW PIPS ARE COUNTED WITHOUT KNOWING WHAT A PIP LOOKS LIKE. `specs/ui.md`
// fixes no palette and no styling, and leaves the HUD's layout to the build past
// the placements its own table states, so nothing here may look for a shape, a
// colour or a place. Two readings stand on the row the table places the pips in.
//
// The first is the count itself, and it is ABSOLUTE. A slot holding nothing
// draws neither icon nor pip, and the pip row gains nothing but pips when the
// slot fills, so the marks the changed pixels form in that row between the frame
// holding nothing and the frame holding the item ARE its pips, and there are as
// many of them as the level it holds (`hud/regions.ts` forms the marks).
//
//   nothing -> Taper 1   one mark in the pip row
//   nothing -> Taper 5   five marks in the pip row
//   nothing -> Brass 3   three marks in the pip row
//
// The second is the differential the count rests on, kept as it was: the marks
// the slot changed between two levels are at least the levels gained and at most
// the levels held, which holds a build that re-lays its pips as their number
// grows to one pip per level without fixing where any of them sits.
//
// WHERE THE PIP ROW IS. The table places the pips in a row and fixes nothing
// else about it, so the row is read off the build's own draw: the icon is the
// same picture in the same place at both levels of one item, so the marks a
// level GAINED are pips, and the rows those marks span together are the row they
// sit in. The count then runs over those rows across the whole slot.
//
// WHERE THE ICON IS. The pips sit "outside the square the icon is drawn in", so
// the icon's own marks are excluded by the rectangle the frame blitted it into,
// grown out to whole device pixels. It is the DRAWN rectangle rather than the
// `ICON_SIZE` (`24`) canvas `specs/assets.md` produces the file on, because
// nothing fixes the size the HUD draws an icon at, and a build drawing its icons
// larger would otherwise be failed for it. A build whose pip row runs beside the
// icon rather than under it is read the same way by it.
//
// WHERE A SLOT IS. `specs/assets.md` produces one icon file per item and
// `specs/ui.md` draws it in the item's slot, so the slot is the square of canvas
// around where the frame blitted that icon. `SLOT_HALF` is generous: an icon is
// `ICON_SIZE` (`24`) square, and forty-eight device pixels either side of its
// centre reaches well past any slot a build draws around one. Nothing else in
// these frames changes at all — every frame holds the OTHER item at the same
// level, every driver switch is off, and no weapon fires — so a square that
// reaches a neighbouring slot costs the reading nothing: that slot draws the
// same picture in both frames of every pair.
//
// THE TOLERANCE. `MIN_PIP_AREA` (`2` changed pixels) on what counts as a mark,
// which keeps an edge left by antialiasing from being a pip of its own, and
// `SLOT_DRIFT` (`1` device pixel) on a slot standing where the other frame drew
// it. The counts themselves are whole numbers compared exactly.
//
// WHY EACH FRAME GETS A HARNESS OF ITS OWN. The five frames then sit at the
// same tick and the same run state and differ in the one item each poses. A
// weapon placed fresh carries a cooldown timer of `0`
// (`specs/instrumentation.md`, `setWeapon`), the same in every frame, so no
// cooldown state moves under the count.

import { afterEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertPointNear,
} from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  type Harness,
  type Blit,
  type PixelRect,
} from "../harness";
import {
  boxAround,
  differenceMask,
  frame,
  markBoxesIn,
  marksIn,
  roundRect,
  rowsSpanned,
  withoutRect,
  type Rect,
} from "./regions";
import { iconBlits, iconAt } from "./slots";

/** The Taper levels the weapon frames hold. */
const TAPER_LOW = 1;
const TAPER_HIGH = 5;

/** The Brass levels the passive frames hold. */
const BRASS_LOW = 1;
const BRASS_HIGH = 3;

/** How far either side of an icon's centre a slot is taken to reach. */
const SLOT_HALF = 48;

/**
 * The fewest changed pixels a mark must hold to be a pip rather than an edge
 * left by antialiasing. A pip legible at the 1280 x 720 stage `specs/ui.md`
 * fixes covers several pixels; two is under any of them.
 */
const MIN_PIP_AREA = 2;

/** How far an icon may sit from where another frame drew it and still be its slot. */
const SLOT_DRIFT = 1;

interface Frame {
  h: Harness;
  pixels: PixelRect;
  blits: Blit[];
}

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

/**
 * An isolated run holding Taper and Brass at the levels named, `null` for an
 * item the run does not hold at all, and the frame it left.
 */
async function frameHolding(
  taper: number | null,
  brass: number | null,
): Promise<Frame> {
  const h = await createHarness();
  harnesses.push(h);
  isolate(h);
  if (taper !== null) holdWeapon(h, "taper", taper);
  if (brass !== null) holdPassive(h, "brass", brass);
  const blits = await h.frameBlits();
  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the posed run is on");
  assertEqual(
    posed.run.weapons.length,
    taper === null ? 0 : 1,
    "the weapons the posed run holds",
  );
  assertEqual(
    posed.run.passives.length,
    brass === null ? 0 : 1,
    "the passives the posed run holds",
  );
  if (taper !== null) {
    assertEqual(posed.run.weapons[0].level, taper, "the Taper level held");
  }
  if (brass !== null) {
    assertEqual(posed.run.passives[0].level, brass, "the Brass level held");
  }
  return { h, pixels: frame(h), blits };
}

/** Where the frame drew `id`'s icon, as the square its slot is read in. */
function slotOf(drawn: Frame, id: "taper" | "brass"): { x: number; y: number } {
  const at = iconAt(drawn.blits, id);
  assertNotNull(at, `where the frame drew ${id}'s icon`);
  return at as { x: number; y: number };
}

/** The rectangle the frame blitted `id`'s icon into, in whole device pixels. */
function iconBox(drawn: Frame, id: "taper" | "brass"): Rect {
  const blits = iconBlits(drawn.blits, id);
  assertGreaterThan(
    blits.length,
    0,
    `blits of ${id}'s icon the frame drawing its slot made`,
  );
  const last = blits[blits.length - 1];
  return roundRect({ x: last.x, y: last.y, w: last.w, h: last.h });
}

/**
 * How many marks `id`'s pip row gains in `held` over `nothing`, the frame whose
 * run does not hold the item at all, with the icon's own rectangle left out.
 */
function pipsGained(
  nothing: Frame,
  held: Frame,
  id: "taper" | "brass",
  row: { y: number; h: number },
): number {
  const at = slotOf(held, id);
  const slot = boxAround(at.x, at.y, SLOT_HALF);
  return marksIn(
    withoutRect(differenceMask(nothing.pixels, held.pixels), iconBox(held, id)),
    { x: slot.x, y: row.y, w: slot.w, h: row.h },
    MIN_PIP_AREA,
  );
}

/** The rows the marks one level's worth of pips added span together. */
function pipRow(
  lower: Frame,
  higher: Frame,
  id: "taper" | "brass",
): { y: number; h: number } {
  const at = slotOf(lower, id);
  const slot = boxAround(at.x, at.y, SLOT_HALF);
  const gained = markBoxesIn(
    differenceMask(lower.pixels, higher.pixels),
    slot,
    MIN_PIP_AREA,
  );
  const rows = rowsSpanned(gained);
  assertNotNull(rows, `the row the pips ${id}'s slot gained sit in`);
  return rows as { y: number; h: number };
}

it("draws one pip per level in a held item's slot", async () => {
  const low = await frameHolding(TAPER_LOW, BRASS_LOW);
  const taperUp = await frameHolding(TAPER_HIGH, BRASS_LOW);
  const brassUp = await frameHolding(TAPER_LOW, BRASS_HIGH);
  const noTaper = await frameHolding(null, BRASS_LOW);
  const noBrass = await frameHolding(TAPER_LOW, null);
  captureStill(taperUp.h, "pips");

  const taperSlot = slotOf(low, "taper");
  const brassSlot = slotOf(low, "brass");
  assertPointNear(
    slotOf(taperUp, "taper"),
    taperSlot,
    SLOT_DRIFT,
    "where Taper's slot sits at the higher level",
  );
  assertPointNear(
    slotOf(brassUp, "brass"),
    brassSlot,
    SLOT_DRIFT,
    "where Brass's slot sits at the higher level",
  );

  const gainedByTaper = marksIn(
    differenceMask(low.pixels, taperUp.pixels),
    boxAround(taperSlot.x, taperSlot.y, SLOT_HALF),
    MIN_PIP_AREA,
  );
  assertBetween(
    gainedByTaper,
    TAPER_HIGH - TAPER_LOW,
    TAPER_HIGH,
    `pips Taper's slot changed between level ${TAPER_LOW} and level ${TAPER_HIGH}`,
  );

  const gainedByBrass = marksIn(
    differenceMask(low.pixels, brassUp.pixels),
    boxAround(brassSlot.x, brassSlot.y, SLOT_HALF),
    MIN_PIP_AREA,
  );
  assertBetween(
    gainedByBrass,
    BRASS_HIGH - BRASS_LOW,
    BRASS_HIGH,
    `pips Brass's slot changed between level ${BRASS_LOW} and level ${BRASS_HIGH}`,
  );

  const taperRow = pipRow(low, taperUp, "taper");
  assertEqual(
    pipsGained(noTaper, taperUp, "taper", taperRow),
    TAPER_HIGH,
    `pips in Taper's slot at level ${TAPER_HIGH}, over a slot holding nothing`,
  );
  assertEqual(
    pipsGained(noTaper, low, "taper", taperRow),
    TAPER_LOW,
    `pips in Taper's slot at level ${TAPER_LOW}, over a slot holding nothing`,
  );

  const brassRow = pipRow(low, brassUp, "brass");
  assertEqual(
    pipsGained(noBrass, brassUp, "brass", brassRow),
    BRASS_HIGH,
    `pips in Brass's slot at level ${BRASS_HIGH}, over a slot holding nothing`,
  );
});
