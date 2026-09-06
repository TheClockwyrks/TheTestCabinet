// Wick — evolutions/chest-level-choice-varies: which held item a chest levels
// is drawn at random.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Opening a chest"), rule 2: "One held item below
//     its max level ... is chosen uniformly at random and rises by `1`", and
//     the result names it as `item`.
//   - `specs/evolutions.md` ("The recipe"): Taper evolves only beside Wick, and
//     no Wick is held, so rule 1 never applies and every chest of this point
//     falls to rule 2.
//   - `specs/passives.md`: Brass has `maxLevel` `3`;
//     `specs/progression.md` ("Slots"): `MAX_WEAPON_LEVEL` is `8`. Taper at 3
//     and Brass at 1 are therefore exactly two candidates.
//
// WHAT IS READ. `CHESTS` (40) chests, each opened over the same two candidates,
// posed back to their levels before each: the item each result names. More
// than one distinct item appears across the forty. A build that always levels
// the first slot, the weapon, or the passive names one item forty times.
// Nothing is posed for the draw itself; a posed item is
// `instrumentation/set-next-chest-item`.
//
// WHY THE NIGHT IS POSED AS IT IS. Exactly two candidates, so the draw has
// something to vary between and the reading is the draw rather than the pool;
// nothing on the field and every driver switch off. The overlay each chest
// opens is left through `setScreen("playing")`, which "Sets `screen` to `name`
// ... Nothing else changes", and the two items are posed back to their levels
// through `setWeapon` and `setPassive`, which leave a held slot standing.
//
// TOLERANCE. Forty independent uniform draws over two candidates land on one
// item with probability 2 × 2^-40, so a conformant build fails this reading
// about never and a build that never varies fails it every time.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  createHarness,
  openChest,
  type Harness,
} from "../harness";
import { assertResultKind, poseChestNight } from "./chest";

/** The two candidates: a weapon below 8 and a passive below its max. */
const WEAPON = "taper";
const WEAPON_LEVEL = 3;
const PASSIVE = "brass";
const PASSIVE_LEVEL = 1;

/** How many chests are opened. */
const CHESTS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("levels Taper on some of forty chests and Brass on others", async () => {
  poseChestNight(h);
  const chosen = new Set<string>();
  for (let chest = 1; chest <= CHESTS; chest += 1) {
    h.debug.setWeapon(0, WEAPON, WEAPON_LEVEL);
    h.debug.setPassive(0, PASSIVE, PASSIVE_LEVEL);

    const after = await openChest(h);
    if (chest === CHESTS) captureStill(h, "random");
    const result = assertResultKind(after, "level", `chest ${chest}`);
    if (result.kind !== "level") fail("a level result", result.kind);
    assertEqual(
      result.item === WEAPON || result.item === PASSIVE,
      true,
      `the item leveled by chest ${chest}, one of the two held`,
    );
    chosen.add(result.item);
    if (after.screen === "chest") h.debug.setScreen("playing");
  }

  assertGreaterThan(
    chosen.size,
    1,
    `distinct items leveled across ${CHESTS} chests (${[...chosen].join(", ")})`,
  );
});
