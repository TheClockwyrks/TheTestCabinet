// Wick — audio/cue-hit-once-per-tick: a tick on which a Flare burst damages
// twenty moths plays `hit` exactly once.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`hit` | An enemy takes damage. At most once per
//     tick", and, in the paragraph below the table, "a tick on which twenty
//     enemies take damage plays `hit` once".
//   - specs/weapons.md (Flare): "On firing, every enemy within `radius` of the
//     player's center takes `damage` on that tick", with row 1 giving damage
//     `100` and radius `640`.
//   - specs/instrumentation.md: "`setWeaponCooldown(slot, 0)` makes that the
//     next tick" the weapon fires on, and a pose "sounds nothing".
//
// WHAT IS READ. Exactly one `hit` play across the one firing tick, with all
// twenty moths off the field and `kills` at twenty as the evidence that twenty
// enemies really did take damage on that tick.
//
// WHY THE NIGHT IS POSED AS IT IS. `audio/crowd.ts` states the ring: twenty
// moths evenly spaced 200 units from the lamplighter, well inside the burst's
// radius, on an otherwise empty night holding Flare alone with every switch
// but `weaponFire` off. Nothing else can raise a cue on the tick, so the count
// is exactly the number of times the twenty simultaneous hits sounded.
//
// TOLERANCE. None. Every reading is a count.

import { afterEach, beforeEach, it } from "vitest";
import { captureReplay, createHarness, onCue, type Harness } from "../harness";
import { assertCrowdFell, poseCrowd } from "./crowd";
import { assertPlayed } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays hit once for twenty moths damaged on one tick", async () => {
  poseCrowd(h);
  const cues = onCue(h);

  const after = await captureReplay(h, "once", () => h.tick(1));

  assertCrowdFell(after);
  assertPlayed(cues, "hit", 1, "hit cues on the tick twenty moths were hit");
});
