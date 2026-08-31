// Meltdown — controls/arm-hotkeys: the number keys arm the shop.
//
// THE RULE. `arm1` through `arm8` arm the eight shop types "in the shop order of
// `TOWER_TYPES`" (specs/controls.md, The actions), and the bindings table binds
// those eight actions to `Digit1` through `Digit8` (specs/controls.md, The
// bindings). Arming a type holds a build preview carrying the type held
// (specs/building.md, Arming a type), which the snapshot reports as `build.type`
// (specs/instrumentation.md, Snapshot shape).
//
// WHY THE KEYS ARE WRITTEN OUT RATHER THAN READ BACK OFF `BINDINGS`. The
// specification fixes the binding, so the check presses the physical key the
// specification names. A check that pressed whatever the build's own table said
// would pass a build that rebound the shop, and the binding is as much under
// test here as the arming.
//
// WHY EIGHT READINGS IN ONE VALIDATOR. One requirement — the mapping from digit
// to shop entry — is one item. Each press names itself in its own failure
// context, so a build that armed the right type from seven keys and the wrong one
// from the eighth fails naming the key it got wrong.
//
// The money is posed above every build cost, because an entry priced above the
// money is drawn disabled (specs/hud.md, The shop) and this item is about the key
// rather than about the purse. Nothing else is posed: an empty, quiet floor is
// all an arming needs.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS, TOWER_TYPES } from "../../src/constants";
import { assertEqual, assertNotNull } from "../assert";
import { captureStill, createHarness, startRun, type Harness } from "../harness";

/**
 * Money above the dearest build cost specs/towers.md gives a tower, so no shop
 * entry is disabled while this runs. It is a pose, not a tolerance.
 */
const PLENTY = Math.max(...TOWER_TYPES.map((type) => TOWER_DEFS[type].cost)) + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("arms each of the eight shop types from its own number key", async () => {
  startRun(h);
  h.debug.setMoney(PLENTY);

  for (const [index, type] of TOWER_TYPES.entries()) {
    // `Digit1` .. `Digit8`, as KeyboardEvent.code values.
    const key = `Digit${index + 1}`;
    await h.tap(key);
    captureStill(h, "armed");

    const held = h.snapshot().build;
    assertNotNull(held, `${key}: a placement is held`);
    assertEqual(held?.type, type, `${key}: the type it armed`);
  }
});
