// Wick — audio/cue-pickup-not-on-gem-or-chest: a tick that collects a gem
// plays no `pickup` cue, and neither does one that collects a chest.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`pickup` | `CUES.pickup` | Bread or a draft is
//     collected". The table binds each cue to one event and no other, and the
//     thirteen one-shot cues are "each a distinct sound so the events are told
//     apart by ear"; a gem's collection has its own row, "`gem` | A gem is
//     collected", and a chest's has "`chest` | A chest overlay opens".
//   - specs/world.md (Gems): "a gem whose center is at most `COLLECT_RADIUS`
//     from the lamplighter's center is collected on that tick"; (Pickups)
//     "`chest` ... Opens the chest overlay".
//   - specs/instrumentation.md: a pose "sounds nothing".
//
// WHAT IS READ. No `pickup` play across the tick that collects a gem, and none
// across the tick that collects a chest, with the empty gem list and the
// `chest` screen as the evidence that each collection really happened.
//
// WHY THE TWO NIGHTS ARE POSED AS THEY ARE. Both are isolated nights with
// nothing on the field but the one thing collected, no weapon or passive held,
// and every driver switch off, so no bread or draft can be on the field to
// sound the cue honestly and nothing else can raise a cue at all. Each sits on
// the lamplighter's own center, a distance of `0`, so the collection lands on
// the first tick. `isolate` poses level `ISOLATE_LEVEL` (50), whose `xpToNext`
// of 495 one small gem cannot reach, so no overlay opens over the first
// reading.
//
// TOLERANCE. None. Both readings are counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  onCue,
  openChest,
  spawnGemAt,
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

it("plays no pickup cue on a gem's tick or a chest's tick", async () => {
  isolate(h);
  const { player } = h.snapshot().run;
  spawnGemAt(h, "small", player.x, player.y);
  const onGem = onCue(h);

  const afterGem = await captureReplay(h, "silent", () => h.tick(1));

  assertEqual(afterGem.run.gems.length, 0, "gems left after the gem's tick");
  assertPlayed(onGem, "pickup", 0, "pickup cues on the gem's tick");

  isolate(h);
  const onChest = onCue(h);

  const afterChest = await openChest(h);

  assertEqual(afterChest.screen, "chest", "the screen after the chest's tick");
  assertPlayed(onChest, "pickup", 0, "pickup cues on the chest's tick");
});
