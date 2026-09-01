// hud/level-pips — a held item's slot shows one pip per level it holds.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Weapon slots |
// `WEAPON_SLOTS` (`6`) slots in slot order, each held weapon as its icon with one
// pip per level held", and "Passive slots | `PASSIVE_SLOTS` (`6`) slots, the same
// way". `specs/assets.md` puts the pips among what the build draws in code, so
// nothing here looks for a produced file.
//
// HOW PIPS ARE COUNTED WITHOUT KNOWING WHAT ONE LOOKS LIKE. `specs/ui.md` fixes
// no palette, no layout, and no styling, so a pip is not looked for: two frames
// are drawn a level apart with nothing else changed, and the marks a level added
// are the connected regions of pixels the two frames differ on. The icon, the
// slot, the bars, the clock, and the world are the same in both, so what is left
// is pips: raising Taper from `1` to `5` adds four of them, and raising Brass
// from `1` to `3` adds two.
//
// The count is taken as a DIFFERENCE between two levels rather than as an
// absolute count of marks, which is what lets a build draw whatever chrome it
// likes around the pips — a frame, a rail, a dimmed pip for a level not yet
// held — since anything a slot draws at both levels cancels. It also carries a
// build that centres its pips rather than anchoring them, since a pip that stands
// where a pip already stood changed nothing.
//
// THE FIGURES. `MAX_WEAPON_LEVEL` (`8`) is Taper's ceiling (specs/weapons.md) and
// `5` is inside it; Brass's `maxLevel` is `3` in `PASSIVES` (specs/passives.md),
// so `3` is its ceiling. Both slots are read because the specification states the
// rule for a weapon slot and then extends it to the passive slots.
//
// THE TOLERANCE. `MARK_MIN_AREA`, two pixels: a mark a player counts at a glance
// is larger than that, and the single pixel an antialiased edge leaves is not a
// mark. There is no tolerance on the count itself: "one pip per level held" is
// exact, and four levels added must add four marks.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  type Harness,
} from "../harness";
import { differenceMask, marksIn, wholeOf, MARK_MIN_AREA } from "./regions";
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

it("adds one mark to a slot for each level the item gains", async () => {
  await poseNight(h);
  const slot = await holdWeapon(h, "taper", TAPER_LOW);
  const taperLow = await drawnPixels(h);
  await h.debug.setWeapon(slot, "taper", TAPER_HIGH);
  const taperHigh = await drawnPixels(h);

  const passive = await holdPassive(h, "brass", BRASS_LOW);
  const brassLow = await drawnPixels(h);
  await h.debug.setPassive(passive, "brass", BRASS_HIGH);
  const brassHigh = await drawnPixels(h);
  await captureStill(h, "pips");

  const added = (a: typeof taperLow, b: typeof taperHigh): number => {
    const mask = differenceMask(a, b);
    return marksIn(mask, wholeOf(mask), MARK_MIN_AREA);
  };
  assertEqual(
    added(taperLow, taperHigh),
    TAPER_HIGH - TAPER_LOW,
    `the marks Taper's slot gained between level ${TAPER_LOW} and level ${TAPER_HIGH}`,
  );
  assertEqual(
    added(brassLow, brassHigh),
    BRASS_HIGH - BRASS_LOW,
    `the marks Brass's slot gained between level ${BRASS_LOW} and level ${BRASS_HIGH}`,
  );
});
