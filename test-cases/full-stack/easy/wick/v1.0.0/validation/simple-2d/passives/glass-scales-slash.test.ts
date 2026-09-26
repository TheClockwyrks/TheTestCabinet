// passives/glass-scales-slash — Glass scales a slash's width and height.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"):
// "areaMul = 1 + GLASS_AREA_PER_LEVEL × glass", with GLASS_AREA_PER_LEVEL 0.1,
// so Glass 2 gives 1.2; and ("Area") "`areaMul` scales every length a weapon's
// table or stat row gives for the shape it hits with", the table naming "Taper,
// Pyre | slash `width`, slash `height`". Row 1 of TAPER_LEVELS gives width 120
// and height 40 (specs/weapons.md, "Taper"), so the slash reads 120 × 1.2 = 144
// and 40 × 1.2 = 48.
//
// THE WORLD. An isolated playing run: nothing on the field, Glass at level 2 in
// the first passive slot, Taper alone at level 1 with its timer at 0, and every
// driver switch off but weaponFire. Taper needs no target and its amount at
// level 1 is 1, so exactly one slash exists after the firing tick and no other
// weapon can add a zone beside it.
//
// WHAT IS READ. The one slash zone's `width` and `height` after the firing
// tick. specs/instrumentation.md ("Snapshot shape"): "`width` and `height`
// appear on a slash alone".
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on each, a product of two stated figures
// read back as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  TAPER_LEVELS,
  derived,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  present,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armAll, holdPassives } from "./night";

/** The passives held: Glass at level 2. */
const HELD: HeldPassives = { glass: 2 };

/** The Taper level fired: row 1, width 120, height 40, amount 1. */
const LEVEL = 1;

/** 1 + 0.1 × 2 = 1.2. */
const AREA = derived.areaMul(HELD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the level-1 slash width 144 and height 48 with Glass 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  armAll(h, [["taper", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "slash");

  const slashes = zonesOfKind(after, "slash");
  assertLength(slashes, 1, "slashes after the firing tick");
  assertWithin(
    present(slashes[0].width, "the slash's width"),
    TAPER_LEVELS[LEVEL - 1].width * AREA,
    FIGURE_TOLERANCE,
    "the slash's width with Glass 2 held",
  );
  assertWithin(
    present(slashes[0].height, "the slash's height"),
    TAPER_LEVELS[LEVEL - 1].height * AREA,
    FIGURE_TOLERANCE,
    "the slash's height with Glass 2 held",
  );
});
