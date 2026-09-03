// pickups/all-bread-and-drafts-collected — every bread and draft meeting the
// condition is collected on that tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Collection"): "Every bread
// and draft that meets the condition on a tick is collected on that tick. Of
// the chests that meet it on one tick, the one with the lowest `id` alone is
// collected, and the others wait for the next `playing` tick." The one-per-tick
// rule is the chests' alone, so three pickups of the other two kinds standing
// on the lamplighter's center, all at distance `0` and so all inside
// `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS` (`12`), are all taken by one
// tick. A build that applies the chest rule to every kind leaves two of them
// lying there.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so the three posed
// pickups are the only ones in the world and nothing else removes one. Two
// bread and one draft are posed, so the tick has more than one of a kind to
// take and a kind boundary to cross; no chest is posed, because a chest would
// open an overlay and end the tick on another screen. `hp` is posed to
// `POSED_HP` (`10`) so both bread heals are real gains under `BASE_MAX_HP`
// (`100`) rather than no-ops against a full bar, and the health read after the
// tick names how many were actually taken. No gem is on the field, so the draft
// has nothing to attract and the reading is the collection alone.
//
// THE TOLERANCE. `REAL_EPS` on `hp`, "a real number"; the pickup count and the
// screen are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BASE_MAX_HP, BREAD_HEAL, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placePickup,
  type Harness,
} from "../harness";

/** Low enough that two whole `BREAD_HEAL`s fit under `BASE_MAX_HP` (`100`). */
const POSED_HP = 10;

/** How many bread stand on the center beside the draft. */
const BREADS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("collects two bread and a draft on the lamplighter's center in one tick", async () => {
  const opened = isolate(h);
  assertNear(
    opened.run.maxHp,
    BASE_MAX_HP,
    REAL_EPS,
    "the maximum health with no Tallow held",
  );
  h.debug.setHp(POSED_HP);
  const at = opened.run.player;
  for (let n = 0; n < BREADS; n += 1) placePickup(h, "bread", at.x, at.y);
  placePickup(h, "draft", at.x, at.y);
  assertEqual(
    h.snapshot().run.pickups.length,
    BREADS + 1,
    "the pickups posed on the lamplighter's center",
  );

  const after = await advanceTicks(h, 1);
  captureStill(h, "all");

  assertEqual(after.screen, "playing", "the screen the collecting tick left");
  assertEqual(
    after.run.pickups.length,
    0,
    "the pickups left after one tick (specs/world.md, Collection: every bread and draft that meets the condition on a tick is collected on that tick)",
  );
  assertNear(
    after.run.player.hp,
    POSED_HP + BREADS * BREAD_HEAL,
    REAL_EPS,
    "the health after both bread were collected",
  );
});
