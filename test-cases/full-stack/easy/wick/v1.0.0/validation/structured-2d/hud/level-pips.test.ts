// hud/level-pips — a held item's slot carries one pip per level held.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Weapon slots |
// `WEAPON_SLOTS` (`6`) slots in slot order, each held weapon as its icon with
// one pip per level held", and "Passive slots | `PASSIVE_SLOTS` (`6`) slots, the
// same way."
//
// THE FIGURES, AND WHERE THEY COME FROM. `specs/progression.md` levels a base
// weapon to `MAX_WEAPON_LEVEL` (`8`) and a passive to its own max, and
// `specs/passives.md` gives Brass a max of `3`, so Taper at `5` and Brass at `3`
// are levels a run reaches. One pip per level makes Taper's slot carry five and
// Brass's three.
//
// HOW PIPS ARE COUNTED WITHOUT KNOWING WHAT A PIP LOOKS LIKE. `specs/ui.md`
// fixes no palette, no layout, and no styling, so nothing here may look for a
// shape, a colour or a place. What "one pip per level" means to a script is that
// a slot at a higher level carries that many MORE separate marks than the same
// slot at a lower level: three frames are taken, differing in one held level
// each, and the marks the changed pixels form inside the slot are counted
// (`hud/regions.ts`).
//
//   Taper 1 -> Taper 5   at least four marks change in Taper's slot, at most five
//   Brass 1 -> Brass 3   at least two marks change in Brass's slot, at most three
//
// The lower bound is the levels gained, and it is the bound with the teeth: a
// build that draws a fixed decoration changes no mark, one that draws a number
// or a growing bar changes one region rather than four, and one that stops
// drawing pips past a ceiling changes fewer than it gained. The upper bound is
// the levels HELD, and it is what keeps the reading honest for a build that
// re-lays its pips as their number grows: a row a build re-centres or re-spaces
// may leave every one of its marks changed, which is still one pip per level,
// and never more marks than the level it drew.
//
// WHERE A SLOT IS. `specs/assets.md` produces one icon file per item and
// `specs/ui.md` draws it in the item's slot, so the slot is the square of canvas
// around where the frame blitted that icon. `SLOT_HALF` is generous: an icon is
// `ICON_SIZE` (`24`) square, and forty-eight device pixels either side of its
// centre reaches well past any slot a build draws around one. Nothing else in
// these frames changes at all — only a held level was posed, every driver switch
// is off, and no weapon fires — so a generous square costs the reading nothing.
//
// WHY EACH FRAME GETS A HARNESS OF ITS OWN. The three frames then sit at the
// same tick and the same run state and differ in the one level each poses. A
// weapon placed fresh carries a cooldown timer of `0`
// (`specs/instrumentation.md`, `setWeapon`), the same in every frame, so no
// cooldown state moves under the count.

import { afterEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
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
import { boxAround, differenceMask, frame, marksIn } from "./regions";
import { iconAt } from "./slots";

/** The Taper levels the two weapon frames hold. */
const TAPER_LOW = 1;
const TAPER_HIGH = 5;

/** The Brass levels the two passive frames hold. */
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

/** An isolated run holding Taper and Brass at the levels named, and its frame. */
async function frameAt(taper: number, brass: number): Promise<Frame> {
  const h = await createHarness();
  harnesses.push(h);
  isolate(h);
  holdWeapon(h, "taper", taper);
  holdPassive(h, "brass", brass);
  const blits = await h.frameBlits();
  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the posed run is on");
  assertEqual(posed.run.weapons[0].level, taper, "the Taper level held");
  assertEqual(posed.run.passives[0].level, brass, "the Brass level held");
  return { h, pixels: frame(h), blits };
}

/** Where the frame drew `id`'s icon, as the square its slot is read in. */
function slotOf(drawn: Frame, id: "taper" | "brass"): { x: number; y: number } {
  const at = iconAt(drawn.blits, id);
  assertNotNull(at, `where the frame drew ${id}'s icon`);
  return at as { x: number; y: number };
}

it("draws one pip per level in a held item's slot", async () => {
  const low = await frameAt(TAPER_LOW, BRASS_LOW);
  const taperUp = await frameAt(TAPER_HIGH, BRASS_LOW);
  const brassUp = await frameAt(TAPER_LOW, BRASS_HIGH);
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
});
