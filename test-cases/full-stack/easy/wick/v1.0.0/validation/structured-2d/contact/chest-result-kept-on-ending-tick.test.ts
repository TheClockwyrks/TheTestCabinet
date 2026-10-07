// contact/chest-result-kept-on-ending-tick — a chest collected on the ending
// tick keeps its result for the end screen.
//
// THE SPEC LINE. `specs/world.md`, "Fallen and dawn": "A tick that ends the
// run opens no overlay: a chest it collected has its result applied and no
// overlay shown, with `chestResult` left set so the end screen's run reports
// it". The snapshot on `fallen` reports "the run that just ended"
// (`specs/instrumentation.md`, Snapshot shape), so `chestResult` on the fallen
// screen reads the result the chest had.
//
// WHY THE RESULT IS A HEAL, AND WHY HP STARTS AT −40. The loadout `loadout.ts`
// describes holds every slot full and every item at its max, so the chest's
// first two rules find nothing and the third applies: "`hp` rises by
// `CHEST_HEAL` (`30`), capped at `maxHp`. The result is `{ kind: "heal" }`"
// (`specs/evolutions.md`, Opening a chest). That heal lands in phase 8, before
// the ending is read in phase 11, so an `hp` of `0` would be lifted to `30`
// and the run would not end. `setHp` has "no lower bound"
// (`specs/instrumentation.md`), so `hp` is posed to `−40`: the heal carries
// it to `−10`, still "`0` or below", and the tick ends fallen with the heal
// visibly applied, `−40 + 30 = −10`.
//
// WHAT IS READ. `chestResult` on the fallen screen, the requirement; and the
// heal's arithmetic, "its result applied", beside it. The collection is read
// first so a build whose chest was never collected fails on that rather than
// on a result it never produced.
//
// THE TOLERANCE. The result is compared structurally; `hp` to `REAL_EPS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { CHEST_HEAL, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placePickup,
  type Harness,
} from "../harness";
import { holdMaxedLoadout } from "./loadout";

/** The hp posed: the chest's heal short of zero by ten. */
const POSED_HP = -CHEST_HEAL - 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads chestResult heal on the fallen screen with the heal applied", async () => {
  if (!(POSED_HP + CHEST_HEAL <= 0)) {
    throw new Error("the heal must leave hp at or below zero");
  }

  isolate(h);
  holdMaxedLoadout(h);
  h.debug.setHp(POSED_HP);
  const { player } = h.snapshot().run;
  placePickup(h, "chest", player.x, player.y);

  const after = await advanceTicks(h, 1);
  captureStill(h, "kept");

  assertEqual(
    after.run.pickups.length,
    0,
    "the chest at the lamplighter's center was collected (specs/world.md, Collection)",
  );
  assertEqual(
    after.screen,
    "fallen",
    "the tick ended the run (specs/world.md, Fallen and dawn)",
  );
  assertDeepEqual(
    after.run.chestResult,
    { kind: "heal" },
    "chestResult on the fallen screen (specs/world.md, Fallen and dawn)",
  );
  assertNear(
    after.run.player.hp,
    POSED_HP + CHEST_HEAL,
    REAL_EPS,
    `hp after the chest's heal of ${CHEST_HEAL} from ${POSED_HP} (specs/evolutions.md, Opening a chest)`,
  );
});
