// Wick — audio/cue-evolve-not-on-other-results: a chest that levels an item
// plays no `evolve` cue, and neither does one that heals.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`evolve` | `CUES.evolve` | A weapon evolves". The
//     table binds each cue to one event, and the paragraph below it has the
//     thirteen one-shot cues "each a distinct sound so the events are told
//     apart by ear", so a chest whose result is not an evolution raises no
//     `evolve` event to play.
//   - specs/evolutions.md (Opening a chest): rule 1 is the only rule that says
//     "the `evolve` cue plays"; rule 2 gives "`{ kind: "level", item, level }`"
//     and rule 3 "`{ kind: "heal" }`". "Its result is decided by the first of
//     these rules that applies", and "A base weapon with no recipe never
//     evolves".
//   - specs/instrumentation.md: a pose "sounds nothing".
//
// WHAT IS READ. No `evolve` play across the tick that collects a chest onto a
// loadout that can only be leveled, and none across the tick that collects one
// onto an empty loadout, with `chestResult` reporting `level` and then `heal`
// as the evidence that each tick took the rule it was posed for.
//
// WHY THE TWO NIGHTS ARE POSED AS THEY ARE. Both are isolated nights with
// nothing on the field and every driver switch off, so nothing else can raise
// a cue. The first holds Taper at level `1` alone: below `MAX_WEAPON_LEVEL`
// it is ineligible for rule 1 and it is the one item rule 2 can raise, so the
// result is a level. The second holds nothing at all, so rules 1 and 2 find no
// item and the result is the heal.
//
// TOLERANCE. None. Both readings are counts, and the results are discrete.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
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

it("plays no evolve cue on a chest that levels or heals", async () => {
  isolate(h);
  holdWeapon(h, "taper", 1);
  const onLevel = onCue(h);

  const leveled = await captureReplay(h, "silent", () => openChest(h));

  assertEqual(leveled.screen, "chest", "the screen after the leveling chest");
  assertDeepEqual(
    leveled.run.chestResult,
    { kind: "level", item: "taper", level: 2 },
    "the leveling chest's result",
  );
  assertPlayed(
    onLevel,
    "evolve",
    0,
    "evolve cues on the leveling chest's tick",
  );

  isolate(h);
  const onHeal = onCue(h);

  const healed = await openChest(h);

  assertEqual(healed.screen, "chest", "the screen after the healing chest");
  assertDeepEqual(
    healed.run.chestResult,
    { kind: "heal" },
    "the healing chest's result",
  );
  assertPlayed(onHeal, "evolve", 0, "evolve cues on the healing chest's tick");
});
