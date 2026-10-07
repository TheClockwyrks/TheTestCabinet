// passives/glass-scales-burst-radius — Glass scales the Flare burst's radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Area, gives the row
// "Flare | burst `radius`" over "The scaled length is the table value times
// `areaMul`", and `areaMul` is `1 + 0.1 × glass`, so `1.2` at Glass 2. Flare's
// level-1 row gives `radius` `640` (`specs/weapons.md`, Flare), so the burst
// reads `768`, which `specs/weapons.md` (Shapes and overlap) says is the
// zone's `radius`: "a burst's is its Flare `radius`".
//
// WHAT THE SCALED RADIUS REACHES. `specs/weapons.md`, Flare: "On firing, every
// enemy within `radius` of the player's center takes `damage` on that tick",
// and "An enemy is within `d` of a point when the distance from that point to
// the enemy's center is at most `d`" (Shapes and overlap). A moth `700` units
// out is inside `768` and outside the unscaled `640`, so under Glass 2 the
// burst reaches it and the moth's `5` hp (`specs/enemies.md`) is gone under
// the row's `damage` of `100`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Glass 2 and Flare
// at level 1, with one moth `700` units out. Flare "fires whether or not any
// enemy exists" and ignores amount, so the one moth is there only to be
// reached. Every driver switch but `weaponFire` stays off, so nothing moves
// and nothing else hits.
//
// THE TOLERANCE. `REAL_EPS` on the burst's radius, one table figure times one
// multiplier; the moth's death and the kill count are whole facts, compared
// exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertUndefined } from "../assert";
import { FLARE_LEVELS, REAL_EPS, areaMul } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  type Harness,
} from "../harness";
import { fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS = 2;

/** The radius Flare's level-1 `640` becomes under Glass 2: `768`. */
const RADIUS = FLARE_LEVELS[0].radius * areaMul(GLASS);

/** Where the moth stands: inside `768` and outside the unscaled `640`. */
const POST = { x: 700, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a level-1 Flare burst radius 768 under Glass 2 and kills a moth 700 units out", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["flare", 1]],
    enemies: [["moth", POST]],
  });
  captureStill(h, "burst");

  const bursts = firing.zones.filter((zone) => zone.kind === "burst");
  assertEqual(
    bursts.length,
    1,
    "the bursts the firing tick created (specs/weapons.md, Flare)",
  );
  assertNear(
    bursts[0].radius,
    RADIUS,
    REAL_EPS,
    "the burst's radius under Glass 2 (specs/passives.md, Area)",
  );
  assertUndefined(
    enemyById(firing.after, firing.targets[0]),
    "the moth 700 units from the lamplighter after the burst (specs/weapons.md, Flare)",
  );
  assertEqual(
    firing.after.run.kills,
    1,
    "the kills the burst scored (specs/weapons.md, Hits and death)",
  );
});
