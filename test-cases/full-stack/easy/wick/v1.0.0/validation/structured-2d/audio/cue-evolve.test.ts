// Wick — audio/cue-evolve: the tick a chest evolves a weapon plays `evolve`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `evolve` to "A weapon evolves", and "Each is played on the tick its event
// happens ... and at most once on that tick." `specs/evolutions.md`, Opening
// a chest, rule 1: "The evolved weapon replaces its base in the same slot
// with a single level, its cooldown timer is set to `0` ..., the passive
// stays held, and the `evolve` cue plays." One evolution on one tick is
// therefore exactly one `evolve`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Taper at
// `MAX_WEAPON_LEVEL` (`8`) and Wick, which is Taper's recipe passive
// (`specs/evolutions.md`, The recipe), and one chest pickup on the
// lamplighter's own center. All three of the recipe's conditions then hold
// on the collecting tick — "it is held at `MAX_WEAPON_LEVEL`; the passive its
// recipe names is held, at any level; the player opens a chest" — and rule 1
// is the first rule that applies, so the chest evolves Taper into Pyre rather
// than levelling or healing.
//
// A distance of `0` is inside `PICKUP_ITEM_RADIUS` (`16`) plus
// `PLAYER_RADIUS` (`12`) whatever the build's pickup radius
// (`specs/world.md`, Collection), so the collection lands on the first tick,
// and `specs/instrumentation.md` names this the real collection path. Every
// driver switch is off and the world holds no enemy, projectile, zone, or
// gem, so nothing else lands on the tick. Whether the overlay's own `chest`
// cue sounds beside it is a different point; only the plays named `evolve`
// are counted.
//
// THE TOLERANCE. None: the specification fixes the cue to the tick of the
// evolution and to at most one play on it, and the collector reads whole
// frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CUES, MAX_WEAPON_LEVEL } from "../constants";
import {
  captureReplay,
  createHarness,
  holdPassive,
  holdWeapon,
  openChest,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays evolve once on the tick a chest evolves a weapon", async () => {
  await isolatedRun(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  holdPassive(h, "wick", 1);

  const { result: after, played } = await captureReplay(h, "evolve", () =>
    cuesOf(h, () => openChest(h)),
  );

  // The premise: the tick really evolved the weapon the recipe names.
  assertDeepEqual(
    after.run.chestResult,
    { kind: "evolve", weapon: "pyre" },
    "the chest's result with Taper at max level and Wick held (specs/evolutions.md)",
  );

  assertEqual(
    heard(played, CUES.evolve),
    1,
    "evolve cues on the tick the weapon evolved (specs/ui.md, Audio)",
  );
});
