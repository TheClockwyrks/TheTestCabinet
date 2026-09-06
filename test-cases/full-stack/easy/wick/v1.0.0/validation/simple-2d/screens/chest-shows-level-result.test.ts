// screens/chest-shows-level-result — the chest overlay shows a level.
//
// WHAT THIS DECIDES. One thing: when a chest leveled an item, the overlay shows
// that item's icon, its name, and `LEVEL_LABEL` with the level it became.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`chest`, the result table): "`level` | The item's icon and
//   name, and `LEVEL_LABEL` with the level it became."
//   specs/evolutions.md ("Opening a chest"): "2. Level. One held item below its
//   max level ... is chosen uniformly at random and rises by `1` ... The result is `{ kind: "level", item, level
//   }`, with `level` the level it became", reached only when no held weapon is
//   eligible to evolve.
//   specs/progression.md ("Slots"): "A base weapon levels up to
//   `MAX_WEAPON_LEVEL`", so Taper held at `3` becomes `4`.
//
// THE DRIVE, AND WHY THE ITEM IS THE ONLY ONE HELD. An isolated `playing` run
// holds Taper at level `3` and nothing else, so the only item below its max is
// Taper and the random choice among candidates has exactly one candidate to
// make: the result is fixed without reading the build's generator. No passive
// is held, so no evolution is eligible and rule 1 passes over. A chest at the
// lamplighter's center is collected by one tick, the real path.
//
// THE ICON, READ AS A DIFFERENCE. The leveled weapon also sits in a HUD slot,
// and the same produced file serves both, so the count is taken on the overlay
// and again after `setScreen("playing")`, which "sets the screen and nothing
// else" (specs/instrumentation.md), over the same loadout.
// The overlay must paint the icon more times than the world beneath it does.
//
// THE TOLERANCE. The name and the label are matched as words in order through
// `drewPhrase`, which admits two runs or a marker between them. The run's own
// level is posed to `RUN_LEVEL`, far from the tag's number, so the HUD's level
// cannot supply the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { LEVEL_LABEL, WEAPON_NAMES, iconPath } from "../constants";
import {
  blitsOfFile,
  captureStill,
  createHarness,
  drewPhrase,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";

let h: Harness;

/** The one item held below its max, so the chest's random choice is forced. */
const ITEM = "taper";
const HELD_LEVEL = 3;
const BECAME = HELD_LEVEL + 1;

/** The run's own level, far from `BECAME`, so the HUD cannot supply the tag. */
const RUN_LEVEL = 17;

/** How many times the frame just drawn painted the produced icon of the item. */
async function iconBlits(harness: Harness): Promise<number> {
  const { blits } = await harness.frameDraw();
  return blitsOfFile(blits, iconPath(ITEM)).length;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("shows the leveled item's icon, name, and new level", async () => {
  isolate(h, { level: RUN_LEVEL });
  holdWeapon(h, ITEM, HELD_LEVEL);

  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the collected chest opened");
  assertDeepEqual(
    opened.run.chestResult,
    { kind: "level", item: ITEM, level: BECAME },
    "the result the chest applied",
  );

  const { calls } = await h.frameDraw();
  captureStill(h, "level");
  assertEqual(
    drewPhrase(calls, WEAPON_NAMES[ITEM]),
    true,
    `the level result draws ${WEAPON_NAMES[ITEM]}, its name in WEAPON_NAMES`,
  );
  assertEqual(
    drewPhrase(calls, `${LEVEL_LABEL} ${BECAME}`),
    true,
    `the level result draws ${LEVEL_LABEL} ${BECAME}, the level it became`,
  );

  const onOverlay = await iconBlits(h);
  h.debug.setScreen("playing");
  const beneath = await iconBlits(h);
  assertGreaterThan(
    onOverlay,
    beneath,
    `paintings of the ${ITEM} icon on the overlay, over the world beneath it`,
  );
});
