// passives/glass-scales-slash — Glass scales a slash's width and height.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` gives the term and the
// formula: `GLASS_AREA_PER_LEVEL` is `0.1`, and
// "areaMul = 1 + GLASS_AREA_PER_LEVEL × glass", so Glass 2 is `1.2`. The Area
// section applies it and names the lengths: "`areaMul` scales every length a
// weapon's table or stat row gives for the shape it hits with. The scaled
// length is the table value times `areaMul`", with the row "Taper, Pyre |
// slash `width`, slash `height`". Taper's level-1 row gives `width` `120` and
// `height` `40` (`specs/weapons.md`, Taper), so the slash reads `144` and
// `48`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Glass 2 and Taper
// at level 1 alone. Taper needs no target (`specs/weapons.md`, Targeting
// summary), so the world holds no enemy, the slash hits nothing, and the two
// lengths are read straight off the zone the firing tick created. Every driver
// switch but `weaponFire` stays off.
//
// THE TOLERANCE. `REAL_EPS` on each length, one table figure times one
// multiplier; the unscaled figures, `120` and `40`, are tens of units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, TAPER_LEVELS, areaMul } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS = 2;

/** Taper's level-1 row, whose `width` is `120` and `height` `40`. */
const ROW = TAPER_LEVELS[0];

const WIDTH = ROW.width * areaMul(GLASS);
const HEIGHT = ROW.height * areaMul(GLASS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a level-1 Taper slash width 144 and height 48 under Glass 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["taper", 1]],
  });
  captureStill(h, "slash");

  assertEqual(
    firing.zones.length,
    ROW.amount,
    "the slashes the firing tick created (specs/weapons.md, Taper)",
  );
  assertNear(
    firing.zones[0].width ?? NaN,
    WIDTH,
    REAL_EPS,
    "the slash's width under Glass 2 (specs/passives.md, Area)",
  );
  assertNear(
    firing.zones[0].height ?? NaN,
    HEIGHT,
    REAL_EPS,
    "the slash's height under Glass 2 (specs/passives.md, Area)",
  );
});
