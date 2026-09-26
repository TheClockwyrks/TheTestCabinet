// Wick — instrumentation/remove-enemy: `removeEnemy(id)` on a moth leaves
// that moth gone and every other enemy present, with kills unchanged, no gem
// or pickup dropped, and no cue played.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `removeEnemy(id)`: "Removes enemy `id`. Nothing drops, nothing counts as a
// kill, and no cue plays."
//
// THE POSE. An isolated run with three moths, kills posed to 4, a cue
// collector opened after the arrangement, the call, read at the call: the
// other two by id, kills 4, no gem, no pickup, nothing on the collector.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  onCue,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED_KILLS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes one enemy without a kill, a drop, or a cue", async () => {
  isolate(h);
  // "Nothing drops" is one of the readings, so `drops` is turned back on:
  // with it off a real death leaves nothing either, and the reading would
  // pass for a build whose `removeEnemy` killed rather than removed.
  enable(h, "drops");
  h.debug.setKills(POSED_KILLS);
  const a = placeEnemy(h, "moth", 300, 0);
  const b = placeEnemy(h, "moth", -300, 0);
  const c = placeEnemy(h, "moth", 0, 300);
  const played = onCue(h);

  h.debug.removeEnemy(b);
  const after = h.snapshot();
  const playedAtCall = played.length;
  await h.frameDraw();
  captureStill(h, "removed");

  assertDeepEqual(
    after.run.enemies.map((enemy) => enemy.id),
    [a, c],
    "enemy ids after removeEnemy",
  );
  assertEqual(after.run.kills, POSED_KILLS, "run.kills after removeEnemy");
  assertLength(after.run.gems, 0, "gems after removeEnemy");
  assertLength(after.run.pickups, 0, "pickups after removeEnemy");
  assertEqual(playedAtCall, 0, "cues played at the removeEnemy call");
});
