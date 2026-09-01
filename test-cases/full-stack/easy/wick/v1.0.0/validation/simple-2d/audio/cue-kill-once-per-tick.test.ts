// Wick — audio/cue-kill-once-per-tick: a tick on which a Flare burst kills
// twenty moths plays `kill` exactly once.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`kill` | An enemy dies. At most once per tick",
//     and "a tick that raises several different cues plays each of those
//     once".
//   - specs/weapons.md (Flare): "every enemy within `radius` of the player's
//     center takes `damage` on that tick", row 1 dealing `100`; specs/enemies.md
//     gives a moth `5` HP, so every moth in the ring dies on the firing tick.
//   - specs/world.md (One tick, phase 6): "an enemy whose `hp` is at or below
//     `0` dies".
//
// WHAT IS READ. Exactly one `kill` play across the one firing tick, with the
// field empty and `kills` at twenty as the evidence that twenty deaths landed
// on that one tick.
//
// WHY THE NIGHT IS POSED AS IT IS. `audio/crowd.ts` states the ring: twenty
// moths evenly spaced 200 units from the lamplighter, well inside the burst's
// radius, on an otherwise empty night holding Flare alone with every switch
// but `weaponFire` off, so nothing else on the night can raise a cue.
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

it("plays kill once for twenty moths killed on one tick", async () => {
  poseCrowd(h);
  const cues = onCue(h);

  const after = await captureReplay(h, "once", () => h.tick(1));

  assertCrowdFell(after);
  assertPlayed(cues, "kill", 1, "kill cues on the tick twenty moths died");
});
