// Floe — audio/mute-silences: with the mute bit on, the crossing carries on —
// the hop lands, the bay fills and scores, and the fresh crossing begins.
//
// WHAT THIS POINT HOLDS, AND WHAT IT DOES NOT. `specs/ui.md` states the rule
// beside the ten cues — "the game stays fully playable with sound muted" — and
// this point is the PLAYABILITY half of it: the muted hop lands, the muted bay
// fills and is scored, and the crossing that follows begins. That nothing came
// out of it is `audio/mute-produces-no-sound`, which is `engines = ["none"]`
// because under an engine the mute bit and the cue bus are the engine's own.
// That the two events sound at all is `audio/cue-hop` and `audio/cue-bay`.
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
} from "../constants";
import {
  captureStill,
  createHarness,
  critterTile,
  hop,
  keysFor,
  poseLane,
  startCrossing,
  ticksFor,
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
 * running" half of this point, read rather than assumed.
 */
const SETTLE_TICKS = ticksFor(BAYFILL_PAUSE + 0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the crossing running while muted", async () => {
  // An empty strait, all five bays open, and one stationary raft under the bay's
  // two columns, so a hop along the row and a hop into the bay are both there to
  // take.
  startCrossing(h);
  poseLane(h, WATER_TOP, APPROACH_KIND, [BAY_COL]);
  h.debug.addCritter(BAY_COL, WATER_TOP);

  // Mute, the way a player mutes.
  await h.tap(MUTE_KEY);
  const muted = h.snapshot();

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
});
