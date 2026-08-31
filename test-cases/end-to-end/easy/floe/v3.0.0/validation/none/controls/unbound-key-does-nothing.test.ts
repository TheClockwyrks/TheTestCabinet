// Floe — controls/unbound-key-does-nothing: a key bound to nothing does nothing.
//
// `specs/controls.md` lists the keys the game answers to and closes the list:
// "The game answers to these keys and to no others." `KeyZ` — `UNBOUND_KEY` — is
// not on it, and this point is the control sample for the whole category: every
// other check here presses a key and requires something to happen, and one that
// presses a key and requires nothing to happen is what tells a build that ROUTED
// its bindings apart from one that answers to whatever it is handed. A build
// that reads any keydown as a hop passes eight of this category's points and
// fails only this one.
//
// THE WORLD IS POSED SO THAT NOTHING CAN MOVE ON ITS OWN. `startCrossing` clears
// every vehicle, floe and bear and shuts the four world gates — no bear emerges,
// no catch is tested, no bonus catch arrives on its cadence, the crossing timer
// does not drain — and it opens `playing`/`crossing` with the phase timer at
// rest and the critter settled on the near shore. So the strait carries no lane
// items at all, which is what the item this file decides asks for, and every
// quantity the snapshot reports is at rest before the key goes down. That is
// what makes "unchanged" a fair reading: with nothing moving, anything that
// moved was moved by the key.
//
// THE KEY IS HELD RATHER THAN TAPPED. `specs/controls.md` reads the four
// movement actions as HELD on the `playing` screen and everything else as press
// edges, so a build that answers to an unknown key could answer to either the
// edge or the hold. `holdFor` gives it both: the key goes down, a stretch longer
// than a full hop cooldown runs with it down, and it comes up. A build that read
// the edge would have hopped once; a build that read the hold would have hopped
// twice or more, since `HOP_COOLDOWN` is 0.12 s and the hold is 0.2 s. Either
// shows up here.
//
// AND THE READING IS THE WHOLE SNAPSHOT BUT `simTime`. Not the critter's tile
// alone: a build that routed a stray key to the pause action, to mute, to the
// menu or to the score would be missed by a check that only looked where a hop
// would land. `simTime` is excluded because `specs/instrumentation.md` fixes
// that it "adds `TICK_DT` on every tick whatever the screen", so it accumulates
// over the drive whether or not any key was pressed at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { UNBOUND_KEY } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/**
 * How long the unbound key is held down, in ticks.
 *
 * `specs/hopping.md` fixes `HOP_COOLDOWN` at 0.12 s, which is 14.4 ticks at
 * `TICK_HZ` (120), and fixes that a held direction "hops again the moment the
 * cooldown reaches 0". 24 ticks is 0.2 s: comfortably past one whole cooldown,
 * so a build that read this key as a direction would have hopped at least twice
 * within the hold rather than possibly landing between its edges.
 */
const HOLD_TICKS = 24;

/**
 * The snapshot fields that differ between two readings, `simTime` apart.
 *
 * A whole-snapshot comparison would report the difference as two four-thousand
 * character objects, and `assert.ts` asks a failure to be a pair a reviewer can
 * read. So the comparison is the same one — every field but `simTime`, compared
 * by value — and what it reports is the NAMES of the fields that moved, which is
 * exactly what a build that answered to the key got wrong.
 */
function driftedFields(before: FloeSnapshot, after: FloeSnapshot): string[] {
  const fields = Object.keys(before) as (keyof FloeSnapshot)[];
  return fields
    .filter((field) => field !== "simTime")
    .filter(
      (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
    );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every field of the snapshot but simTime alone while an unbound key is driven", async () => {
  await startCrossing(h);

  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the pose opened a live crossing");
  assertEqual(before.phase, "crossing", "with the crossing running");
  assertEqual(before.vehicles.length, 0, "on a strait with no vehicles");
  assertEqual(before.floes.length, 0, "and no floes");

  await h.holdFor(UNBOUND_KEY, HOLD_TICKS);

  const after = await h.snapshot();
  await captureStill(h, "after");

  assertDeepEqual(
    driftedFields(before, after),
    [],
    "a key bound to no action changes nothing: the game answers to the keys specs/controls.md lists and to no others",
  );
});
