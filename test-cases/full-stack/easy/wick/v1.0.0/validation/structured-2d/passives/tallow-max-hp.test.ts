// passives/tallow-max-hp — Tallow raises maximum health by
// `TALLOW_HP_PER_LEVEL` per level, and a heal may carry `hp` to the new
// maximum.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` gives the term and the
// formula: `TALLOW_HP_PER_LEVEL` is `15`, and
// "maxHp = BASE_MAX_HP + TALLOW_HP_PER_LEVEL × tallow", with `BASE_MAX_HP`
// (`100`) from `specs/world.md`, so Tallow 3 reads `145`. The Max health
// section fixes what a heal may reach: "Every heal and every recovery tick
// caps `hp` at the `maxHp` in force when it is applied." Bread heals
// `BREAD_HEAL` (`30`), "capped at `maxHp`" (`specs/world.md`, Pickups), so
// `hp` posed to `115` and one bread reads exactly `145`, the figure that would
// have been capped at `100` with no Tallow held.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Tallow 3 and
// nothing else, with `hp` posed to `115` through `setHp`, which "leaves `hp`
// untouched" when the passive was placed (`specs/instrumentation.md`,
// `setPassive`). One bread is placed at the lamplighter's center, inside the
// `PICKUP_ITEM_RADIUS + PLAYER_RADIUS` (`28`) collection distance
// (`specs/world.md`, Collection), and one tick collects it. Every driver
// switch stays off, so no enemy, no recovery, and no weapon touches `hp`
// across that tick.
//
// THE TOLERANCE. `REAL_EPS` on `maxHp` and on `hp`, each a sum of whole
// figures; a build that left the maximum at `100` reports forty-five short.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BREAD_HEAL, REAL_EPS, maxHpOf } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  placePickup,
  type Harness,
} from "../harness";

/** The Tallow level held: `maxHp` `145`. */
const TALLOW = 3;

/** The maximum `BASE_MAX_HP` becomes under Tallow 3: `145`. */
const MAX_HP = maxHpOf(TALLOW);

/** The health posed before the heal: `BREAD_HEAL` short of the new maximum. */
const POSED_HP = MAX_HP - BREAD_HEAL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads maxHp 145 under Tallow 3 and lets a bread carry hp to 145", async () => {
  isolate(h);
  holdPassive(h, "tallow", TALLOW);
  const held = h.snapshot();
  assertNear(
    held.run.maxHp,
    MAX_HP,
    REAL_EPS,
    "run.maxHp under Tallow 3 (specs/passives.md, Max health)",
  );

  h.debug.setHp(POSED_HP);
  const { player } = h.snapshot().run;
  placePickup(h, "bread", player.x, player.y);
  const healed = await advanceTicks(h, 1);
  captureStill(h, "max");

  assertEqual(
    healed.run.pickups.length,
    0,
    "the pickups left after the tick that collected the bread (specs/world.md, Collection)",
  );
  assertNear(
    healed.run.player.hp,
    MAX_HP,
    REAL_EPS,
    "hp after a bread healed 30 from 115 under Tallow 3 (specs/passives.md, Max health)",
  );
});
