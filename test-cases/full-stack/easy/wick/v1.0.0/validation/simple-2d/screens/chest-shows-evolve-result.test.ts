// screens/chest-shows-evolve-result — the chest overlay shows an evolution.
//
// WHAT THIS DECIDES. One thing: when a chest evolved a weapon, the overlay
// shows the EVOLVED weapon's icon and its name. The other two result kinds are
// their own points.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`chest`, the result table): "`evolve` | The evolved weapon's
//   icon and its name from `WEAPON_NAMES`."
//   specs/evolutions.md ("The recipe"): "A base weapon is eligible to evolve
//   when all three hold at once: it is held at `MAX_WEAPON_LEVEL` (`8`); the
//   passive its recipe names is held, at any level; the player opens a chest",
//   and the table "Pyre | `pyre` | Taper | Wick".
//   specs/evolutions.md ("Opening a chest"): "the first base weapon at
//   `MAX_WEAPON_LEVEL` whose recipe passive is held at any level evolves ...
//   The result is `{ kind: "evolve", weapon }`."
//   specs/assets.md ("The icons"): "an evolved weapon's icon is shown in its
//   slot and on the chest overlay's evolve result".
//
// THE DRIVE, AND WHY THE ICON IS READ AS A DIFFERENCE. An isolated `playing`
// run holds Taper at `MAX_WEAPON_LEVEL` and Wick, and a chest placed at the
// lamplighter's center is collected by one tick, which is the real path. The
// evolved weapon then sits in a HUD slot as well as on the overlay, and the
// same produced file serves both, so counting blits of it on the overlay's
// frame alone would pass a build that drew the slot and nothing else. The count
// is therefore taken twice: once on the overlay, and once on the frame after
// `setScreen("playing")`, which "sets the screen and nothing else"
// (specs/instrumentation.md) and so leaves the same loadout in the same world
// with the overlay no longer drawn over it. The overlay must paint the icon MORE times than the world beneath
// it does, which is exactly what "shows the evolved weapon's icon" asks.
//
// THE TOLERANCE. None on identity: a blit either painted the produced file for
// `pyre` or it did not, and the name is matched as a substring of a run of
// drawn text through the shared harness's `drewText`, ignoring case and
// whitespace.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { MAX_WEAPON_LEVEL, WEAPON_NAMES, iconPath } from "../constants";
import {
  blitsOfFile,
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";

let h: Harness;

/** Taper at its max beside Wick is the recipe `EVOLUTIONS` gives Pyre. */
const EVOLVED = "pyre";

/** How many times the frame just drawn painted the produced icon of `id`. */
async function iconBlits(harness: Harness): Promise<number> {
  const { blits } = await harness.frameDraw();
  return blitsOfFile(blits, iconPath(EVOLVED)).length;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("shows the evolved weapon's icon and name", async () => {
  isolate(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  holdPassive(h, "wick", 1);

  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the collected chest opened");
  assertDeepEqual(
    opened.run.chestResult,
    { kind: "evolve", weapon: EVOLVED },
    "the result the chest applied",
  );

  const { calls } = await h.frameDraw();
  captureStill(h, "evolve");
  assertEqual(
    drewText(calls, WEAPON_NAMES[EVOLVED]),
    true,
    `the evolve result draws ${WEAPON_NAMES[EVOLVED]}, its name in WEAPON_NAMES`,
  );

  const onOverlay = await iconBlits(h);
  h.debug.setScreen("playing");
  const beneath = await iconBlits(h);
  assertGreaterThan(
    onOverlay,
    beneath,
    `paintings of the ${EVOLVED} icon on the overlay, over the world beneath it`,
  );
});
