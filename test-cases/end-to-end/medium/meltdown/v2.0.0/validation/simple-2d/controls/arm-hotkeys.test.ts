// Meltdown — controls/arm-hotkeys: the eight number keys arm the eight shop
// types, in shop order.
//
// THE RULE. specs/controls.md gives the action row `arm1` to `arm8` — "Arms the
// eight shop types, in the shop order of `TOWER_TYPES`" — and the binding row
// `Digit1` to `Digit8`. specs/building.md says what arming leaves behind: "Arming
// a type holds a build preview. A held preview carries four things: the type
// held..." So the one thing read here is `build.type`.
//
// ONE REQUIREMENT, EIGHT DOORS. The requirement is the MAPPING — which digit arms
// which type — and a mapping is only wrong relative to the whole of it: a build
// that shifted the row by one, or that read `TOWER_TYPES` in some other order,
// arms a real type on every key and is caught by no single key. So all eight are
// posed identically and read identically, and a failure names the digit that armed
// the wrong type. What the preview then CONTAINS is
// `building.arming-holds-a-preview`.
//
// EACH KEY IS POSED FROM A CLEARED PREVIEW. specs/building.md says "Arming a
// second type replaces the held one", so the eight presses could be chained — but
// then a build whose `Digit5` did nothing would read as still holding the type
// `Digit4` armed, and the failure would name the wrong key. Disarming between
// presses makes every reading answer its own key: the preview is either the type
// that key names, or it is `null`.
//
// THE MONEY IS POSED ABOVE THE DEAREST BUILD COST. specs/hud.md draws an entry
// "whose build cost is above the current money" as disabled, and nothing in
// specs/building.md or specs/controls.md says whether such a type still arms. So
// the scenario stays away from that unstated question entirely: with money at the
// dearest cost in the roster, every one of the eight is affordable and the only
// thing the keys can be failing is the mapping.
//
// THE WORLD IS AN EMPTY, QUIET, LIVE RUN. `startRun` empties both rosters and
// shuts the world gate, so nothing arrives on the floor, no wave starts, and
// nothing but the eight keys touches the held preview.

import { afterEach, beforeEach, it } from "vitest";
import {
  ACTIONS,
  BINDINGS,
  TOWER_DEFS,
  TOWER_TYPES,
  type ActionName,
} from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/**
 * Money enough for every entry in the shop, so no entry is the disabled entry of
 * specs/hud.md.
 *
 * The dearest build cost in specs/towers.md's table, read off the roster rather
 * than written out, so the pose follows the specification's own figures.
 */
const AFFORDS_EVERY_TYPE = Math.max(
  ...TOWER_TYPES.map((type) => TOWER_DEFS[type].cost),
);

/**
 * The eight arming actions, `arm1` through `arm8`, in the order specs/controls.md
 * tabulates them — which is the order they pair with `TOWER_TYPES`.
 *
 * Filtered off `ACTIONS` rather than written out, so the pairing below rests on
 * the same two lists the specification does.
 */
const ARM_ACTIONS: readonly ActionName[] = ACTIONS.filter((action) =>
  action.startsWith("arm"),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("arms the eight shop types in TOWER_TYPES order, one per digit key", async () => {
  startRun(h);
  h.debug.setMoney(AFFORDS_EVERY_TYPE);
  await h.advance(1);

  for (const [index, type] of TOWER_TYPES.entries()) {
    const key = BINDINGS[ARM_ACTIONS[index]][0];

    // From nothing held, so the reading answers this key and no earlier one.
    h.debug.setArmed(null);
    await h.advance(1);

    await h.tap(key);
    // Overwritten by each pass, so what survives is the last pose driven — the
    // failing one when a key is wrong, the eighth when they are all right.
    captureStill(h, "armed");

    assertEqual(
      h.snapshot().build?.type ?? null,
      type,
      `${key}: the type held after one press, entry ${index + 1} of ` +
        `${TOWER_TYPES.length} in shop order (specs/controls.md, The actions)`,
    );
  }
});
