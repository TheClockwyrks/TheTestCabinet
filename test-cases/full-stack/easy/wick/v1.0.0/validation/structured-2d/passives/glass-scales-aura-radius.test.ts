// passives/glass-scales-aura-radius — Glass scales the Halo aura's radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Area, gives the row
// "Halo, Corona | aura `radius`" over "The scaled length is the table value
// times `areaMul`", and `areaMul` is `1 + 0.1 × glass`, so `1.2` at Glass 2.
// Halo's level-1 row gives `radius` `80` (`specs/weapons.md`, Halo), so the
// aura reads `96`.
//
// WHERE THE AURA COMES FROM. `specs/weapons.md`, Halo: "Halo is a permanent
// aura: one zone of kind `aura` ... The zone is created on the first `playing`
// tick Halo is held and none exists", and its "`radius` and `damage` are
// recomputed on every tick from the level, `areaMul`, and `damageMul` in force
// on that tick". One tick with Halo held is therefore enough for the aura to
// exist and carry its scaled radius.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Glass 2 and Halo at
// level 1 alone. Halo needs no target, so the world holds no enemy and the
// pulse hits nothing, and every driver switch but `weaponFire` stays off, so
// the one tick creates the aura and does nothing else.
//
// THE TOLERANCE. `REAL_EPS` on the radius, one table figure times one
// multiplier; the unscaled figure, `80`, is sixteen units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { HALO_LEVELS, REAL_EPS, areaMul } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  zonesOfKind,
} from "../harness";
import { fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS = 2;

/** The radius Halo's level-1 `80` becomes under Glass 2: `96`. */
const RADIUS = HALO_LEVELS[0].radius * areaMul(GLASS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives the level-1 Halo aura radius 96 under Glass 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["halo", 1]],
  });
  captureStill(h, "aura");

  const auras = zonesOfKind(firing.after, "aura");
  assertEqual(
    auras.length,
    1,
    "the aura zones held while Halo is held (specs/weapons.md, Halo)",
  );
  assertNear(
    auras[0].radius,
    RADIUS,
    REAL_EPS,
    "the aura's radius under Glass 2 (specs/passives.md, Area)",
  );
});
