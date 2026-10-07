// pickups/bread-heals — collecting bread heals BREAD_HEAL.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Pickups") tables the bread's
// effect, "Heals `BREAD_HEAL` (`30`), capped at `maxHp`", and ("Collection")
// the condition, a distance "less than `PICKUP_ITEM_RADIUS` (`16`) plus
// `PLAYER_RADIUS`", which bread on the lamplighter's own center meets at
// distance 0. `maxHp` is `BASE_MAX_HP` (100) with no Tallow held
// (specs/world.md, "The lamplighter"), so from `POSED` (50) the heal lands
// clear of the cap and `hp` reads exactly 80.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off. Nothing else
// can change health: `enemyContact` is off so nothing hits, and `recovery` is
// `BASE_RECOVERY` (0) with no Tinder held, so the tick's recovery phase adds
// nothing and the whole change in `hp` is the bread's. `hp` is posed to 50 with
// `setHp`, which "Sets `hp`, at most `maxHp`" (specs/instrumentation.md),
// leaving 50 of headroom against a 30-unit heal so the cap cannot hide a build
// healing more than it should.
//
// WHAT IS READ. `hp` after the single collecting tick, 80, with the bread gone
// from the field so the figure is a collection rather than a heal posed beside
// one.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on `hp`, "a real number at most `maxHp`"
// read back as a double; none on the pickup count.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import { BASE_MAX_HP, BREAD_HEAL, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnPickupAt,
  type Harness,
} from "../harness";

/** The health the lamplighter is posed to: 50 of headroom under the cap. */
const POSED = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises hp from 50 to 80 when bread is collected", async () => {
  const posed = isolate(h);
  assertWithin(
    posed.run.maxHp,
    BASE_MAX_HP,
    FIGURE_TOLERANCE,
    "maxHp with no Tallow held",
  );
  h.debug.setHp(POSED);
  const { player } = h.snapshot().run;
  spawnPickupAt(h, "bread", player.x, player.y);
  assertWithin(
    h.snapshot().run.player.hp,
    POSED,
    FIGURE_TOLERANCE,
    "hp before the collecting tick",
  );

  const after = await h.tick(1);
  captureStill(h, "bread");

  assertLength(after.run.pickups, 0, "pickups left after the collecting tick");
  assertWithin(
    after.run.player.hp,
    POSED + BREAD_HEAL,
    FIGURE_TOLERANCE,
    "hp after the bread was collected",
  );
});
