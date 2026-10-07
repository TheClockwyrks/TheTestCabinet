// contact/chest-result-kept-on-ending-tick — a chest collected on the ending
// tick keeps its result: the fallen screen's snapshot reads
// chestResult { kind: "heal" } with the heal applied.
//
// THE RULE, FROM THE SPEC. specs/world.md, Fallen and dawn: "A tick that ends
// the run opens no overlay: a chest it collected has its result applied and no
// overlay shown, with chestResult left set so the end screen's run reports
// it". The result is the heal by the third rule of specs/evolutions.md,
// Opening a chest, which applies when no weapon can evolve and no held item is
// below its max: "hp rises by CHEST_HEAL (30), capped at maxHp. The result is
// { kind: "heal" }." Nothing held satisfies both.
//
// WHY hp IS POSED BELOW −CHEST_HEAL. Phase 8 of One tick collects the chest
// and applies its heal, and phase 11 reads the fallen condition "hp is 0 or
// below" after it. A heal of 30 on hp 0 leaves 30 and no ending, so the pose
// starts hp 40 below 0, which setHp allows ("no lower bound",
// specs/instrumentation.md): the heal carries it to −10, still at or below 0,
// the tick ends the run, and the −10 is the heal's mark on the end screen.
//
// THE POSE. An isolated night with nothing held, hp posed to −40, and one chest
// posed at the lamplighter's center, collected on the next tick by
// specs/world.md's collection rule. Nothing else is on the field and every
// switch is off.
//
// THE TOLERANCE. The result is compared structurally. hp is read within
// FIGURE_TOLERANCE of −40 + 30, exact arithmetic on stated figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import { CHEST_HEAL, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnPickupAt,
  type Harness,
} from "../harness";

/** How far below 0 hp stays after the heal, so the tick still ends the run. */
const MARGIN = 10;

/** The hp posed: the heal's 30 plus the margin below 0. */
const POSED_HP = -(CHEST_HEAL + MARGIN);

/** −40 + 30 = −10. */
const EXPECTED_HP = POSED_HP + CHEST_HEAL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads chestResult heal and the heal applied on the fallen screen", async () => {
  isolate(h);
  h.debug.setHp(POSED_HP);
  const { player } = h.snapshot().run;
  spawnPickupAt(h, "chest", player.x, player.y);

  const after = await h.tick(1);
  captureStill(h, "kept");

  assertEqual(after.screen, "fallen", "screen after the ending tick");
  assertDeepEqual(
    after.run.chestResult,
    { kind: "heal" },
    "chestResult kept on the end screen",
  );
  assertWithin(
    after.run.player.hp,
    EXPECTED_HP,
    FIGURE_TOLERANCE,
    "hp with the chest's heal applied",
  );
});
