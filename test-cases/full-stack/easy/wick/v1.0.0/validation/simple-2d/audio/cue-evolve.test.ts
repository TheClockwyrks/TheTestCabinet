// Wick — audio/cue-evolve: the tick on which a chest evolves Taper plays
// `evolve`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`evolve` | `CUES.evolve` | A weapon evolves", and
//     "Each is played on the tick its event happens".
//   - specs/evolutions.md (Opening a chest, rule 1): "the first base weapon at
//     `MAX_WEAPON_LEVEL` whose recipe passive is held at any level evolves ...
//     and the `evolve` cue plays. The result is `{ kind: "evolve", weapon }`".
//   - specs/evolutions.md (The recipe): Pyre's row, "Pyre | `pyre` | Taper |
//     Wick", so Taper at `MAX_WEAPON_LEVEL` (8) with Wick held evolves to
//     Pyre.
//   - specs/instrumentation.md (`setScreen`): the chest overlay "is reached
//     through `spawnPickup("chest", x, y)` at the lamplighter's center and one
//     tick, which is the real collection path"; a pose "sounds nothing".
//
// WHAT IS READ. Exactly one `evolve` play across the one tick that collects
// the chest, with `chestResult` reporting the evolution to Pyre as the
// evidence that an evolution is what happened on that tick.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night holding Taper at level 8
// and Wick alone, nothing on the field, and every driver switch off, so Taper
// never fires, nothing is hit or killed, and the only event of the tick is the
// chest. Taper occupies the first weapon slot, so rule 1's slot-order search
// reaches it first whatever else a build might hold.
//
// TOLERANCE. None. The reading is a count and the result is discrete.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureReplay,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  onCue,
  openChest,
  type Harness,
} from "../harness";
import { assertPlayed } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays evolve once on the tick the chest evolves Taper", async () => {
  isolate(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  holdPassive(h, "wick", 1);
  const cues = onCue(h);

  const after = await captureReplay(h, "evolve", () => openChest(h));

  assertDeepEqual(
    after.run.chestResult,
    { kind: "evolve", weapon: "pyre" },
    "the chest's result",
  );
  assertPlayed(cues, "evolve", 1, "evolve cues on the tick Taper evolved");
});
