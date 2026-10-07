// contact/chest-result-kept-on-ending-tick — a chest collected on the ending
// tick keeps its result.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Fallen and dawn"): "a chest
// it collected has its result applied and no overlay shown, with `chestResult`
// left set so the end screen's run reports it". The result with nothing held is
// the heal: rule 1 of specs/evolutions.md ("Opening a chest") finds no weapon
// to evolve and rule 2 no "held item below its max level", so rule 3 applies,
// "Heal. `hp` rises by `CHEST_HEAL` (`30`), capped at `maxHp`. The result is
// `{ kind: "heal" }`." So the end screen's snapshot reads `chestResult`
// `{ kind: "heal" }` and an `hp` 30 above what was posed.
//
// WHY HP IS POSED TO -40. The chest is collected at phase 8 and the endings
// are checked at phase 11 (specs/world.md — "One tick"), so the heal is applied
// BEFORE `hp` is judged: from 0 it would read 30 and the run would not end. From
// -40 the heal leaves -10, which is "`0` or below", so the tick ends fallen with
// the heal applied and its result kept. `setHp` allows it: "there is no lower
// bound" (specs/instrumentation.md).
//
// THE DRIVE. An isolated night with every faculty held, nothing alive, and
// nothing held, so every held item is at its max vacuously and the result is
// decided by rule 3 alone. `hp` is posed to -40, a chest is posed at the
// lamplighter's center through `spawnPickup`, "the real collection path", and
// one tick is run. Recovery is 0 with no Tinder held, so the 30 the reading
// rises by is the chest's alone.
//
// THE TOLERANCE. `FLOAT_TOL` on the health, `-40 + 30` exactly; none on the
// screen name or the result.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { CHEST_HEAL, FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
  player,
  type Harness,
} from "../harness";

/** The health posed: far enough below 0 that a heal of 30 leaves it there. */
const POSED_HP = -40;

/** `-40 + 30`. */
const EXPECTED_HP = POSED_HP + CHEST_HEAL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads chestResult heal and the heal applied on the fallen screen", async () => {
  await isolate(h);
  await h.debug.setHp(POSED_HP);

  const after = await openChest(h);

  // The end screen with the chest's result kept on the run it reports.
  // Captured before the assertions, so a failing build leaves the picture that
  // shows why.
  await captureStill(h, "kept");

  assertEqual(
    after.screen,
    "fallen",
    "the screen an ending tick that collected a chest leaves",
  );
  assertDeepEqual(
    after.run.chestResult,
    { kind: "heal" },
    "chestResult on the fallen screen",
  );
  assertNear(
    player(after).hp,
    EXPECTED_HP,
    FLOAT_TOL,
    "hp on the fallen screen, with the chest's heal applied",
  );
});
