// Floe — audio/mute-silences: with the mute bit on, an accepted hop and a filled
// bay put out no audible sound, and the crossing carries on around them.
//
// THE OTHER HALF IS ELSEWHERE. That the two events play their cues in the first
// place is `audio/cue-hop` and `audio/cue-bay`; this point holds the rule
// `specs/ui.md` states beside them — "the game stays fully playable with sound
// muted" — which is two claims about one stretch of play: nothing audible came
// out, and the game went on. Both are read from the same muted stretch.
//
// WHAT SILENCE IS, UNDER AN ENGINE. `engine/audio.md` fixes the reading exactly:
// "a play or a loop on a muted bus reports `gain: 0`", and "a muted cue still
// emits its event, at `gain: 0`". So a muted stretch is one in which NO cue is
// announced at a gain above zero — which holds both for a build that keeps
// playing its cues into a muted bus, and for one that stops asking for them at
// all. Neither is required by `specs/ui.md`, so neither is demanded here; what is
// demanded is that nothing audible comes out.
//
// MUTE IS REACHED THE WAY A PLAYER REACHES IT. `specs/instrumentation.md` gives
// the surface no operation for muting on purpose — "muting is reached the same way
// a player reaches it, through the mute action `specs/controls.md` fixes" — so the
// key is really pressed and the snapshot's `muted` is read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  BAYFILL_PAUSE,
  BAYS,
  ROW_NEAR,
  START_COL,
  WATER_TOP,
} from "../../src/constants";
import {
  captureStill,
  createHarness,
  critterTile,
  hop,
  keysFor,
  poseLane,
  startCrossing,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";

/** The key the mute action is bound to (`specs/controls.md`). */
const MUTE_KEY = keysFor("mute")[0];

/** The bay the crossing is ended in. Any of the five decides the same rule. */
const BAY_INDEX = 2;

/** Its left column, one of the two `specs/strait.md` gives that bay. */
const BAY_COL = BAYS[BAY_INDEX][0];

/** The floe the approach is taken from — `3` tiles by `specs/water.md`. */
const APPROACH_KIND = "raft3";

/** A quarter second of held strait after muting, before anything is pressed. */
const QUIET_TICKS = ticksFor(0.25);

/**
 * Ticks driven after the bay is filled.
 *
 * Past `BAYFILL_PAUSE` (`0.5` s) by a tenth of a second, so the hold
 * `specs/progression.md` runs after a bay is filled expires inside the window and
 * the fresh crossing it leads to is inside it too — which is the "the game keeps
 * running" half of this point, read rather than assumed. A build that plays a cue
 * late is also still inside it.
 */
const SETTLE_TICKS = ticksFor(BAYFILL_PAUSE + 0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts out nothing audible while muted, and keeps the crossing running", async () => {
  // An empty strait, all five bays open, and one stationary raft under the bay's
  // two columns, so a hop along the row and a hop into the bay are both there to
  // take.
  startCrossing(h);
  poseLane(h, WATER_TOP, APPROACH_KIND, [BAY_COL]);
  h.debug.addCritter(BAY_COL, WATER_TOP);

  // Mute, the way a player mutes.
  await h.tap(MUTE_KEY);
  const muted = h.snapshot();

  const played = watchCues(h);

  await h.advance(QUIET_TICKS);

  // An accepted hop along the raft.
  await hop(h, "right");
  const hopped = h.snapshot();

  // And a hop up into the open bay, which ends the crossing.
  await hop(h, "up");
  const filled = h.snapshot();

  await h.advance(SETTLE_TICKS);
  const running = h.snapshot();

  captureStill(h, "muted");

  // The mute bit really is on (specs/ui.md, specs/instrumentation.md).
  assertEqual(
    muted.muted,
    true,
    "one press of the mute key leaves the runtime's mute bit on",
  );

  // The game really kept running: the hop was accepted, the bay filled, the
  // crossing was scored, and a fresh crossing began from the near shore.
  assertDeepEqual(
    critterTile(hopped),
    { col: BAY_COL + 1, row: WATER_TOP },
    "the muted hop moved the critter one tile along the raft",
  );
  assertDeepEqual(
    filled.bays,
    BAYS.map((_, index) => index === BAY_INDEX),
    "the muted hop into the bay filled it, and no other",
  );
  assertGreaterThan(filled.score, 0, "the muted crossing was scored");
  assertEqual(
    running.critter.present,
    true,
    "a fresh crossing began after the hold",
  );
  assertDeepEqual(
    critterTile(running),
    { col: START_COL, row: ROW_NEAR },
    "the fresh crossing began from the near shore",
  );

  // And nothing audible came out of any of it.
  assertDeepEqual(
    played.filter((entry) => entry.gain > 0).map((entry) => entry.cue),
    [],
    "cues sounded at a gain above zero over the muted stretch",
  );
});
