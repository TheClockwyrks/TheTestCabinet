// Floe — audio/mute-silences: with the mute bit on, a hop and a bay fill emit no
// sound at all, and the crossing carries on around them.
//
// THE OTHER HALF IS ELSEWHERE. That the two events sound in the first place is
// `audio/cue-hop` and `audio/cue-bay`; this point holds the rule `specs/ui.md`
// states beside them — "the game stays fully playable with sound muted" — which
// is two claims about one stretch of play: nothing came out, and the game went
// on. Both are read from the same muted stretch.
//
// SILENCE IS READ BOTH WAYS THE HARNESS CAN HEAR IT. `watchCues` attributes an
// emission to the driven call that produced it, which catches anything the
// simulation sounded; `sounds()` is the page's running total, which catches an
// emission a build makes outside a driven call — from a key handler, say. A
// muted stretch has to be silent by both. See audio/cue-hop for what "an
// emission" is and why it is what an engineless build can be heard by at all.
//
// MUTE IS REACHED THE WAY A PLAYER REACHES IT. `specs/instrumentation.md` gives
// the surface no operation for muting on purpose — "muting is reached the same
// way a player reaches it, through the mute action `specs/controls.md` fixes" —
// so the key is really pressed and the snapshot's `muted` is read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  BAYFILL_PAUSE,
  BAYS,
  BINDINGS,
  ROW_NEAR,
  START_COL,
  WATER_TOP,
} from "../constants";
import {
  captureStill,
  createHarness,
  critterTile,
  hop,
  poseLane,
  startCrossing,
  ticksFor,
  ticksPast,
  watchCues,
  type Harness,
} from "../harness";

/** The key the mute action is bound to (`specs/controls.md`). */
const MUTE_KEY = BINDINGS.mute[0];

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
 * running" half of this point, read rather than assumed. A build that sounds late
 * is also still inside it.
 */
const SETTLE_TICKS = ticksPast(BAYFILL_PAUSE) + ticksFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("emits nothing while muted, and keeps the crossing running", async () => {
  // An empty strait, all five bays open, and one stationary raft under the bay's
  // two columns, so a hop along the row and a hop into the bay are both there to
  // take.
  await startCrossing(h);
  await poseLane(h, WATER_TOP, APPROACH_KIND, [BAY_COL]);
  await h.debug.addCritter(BAY_COL, WATER_TOP);
  await h.armAudio();

  // Mute, the way a player mutes.
  await h.tap(MUTE_KEY);
  const muted = await h.snapshot();

  const played = watchCues(h);
  const totalBefore = await h.sounds();

  await h.advance(QUIET_TICKS);

  // An accepted hop along the raft.
  await hop(h, "right");
  const hopped = await h.snapshot();

  // And a hop up into the open bay, which ends the crossing.
  await hop(h, "up");
  const filled = await h.snapshot();

  await h.advance(SETTLE_TICKS);
  const running = await h.snapshot();

  const totalAfter = await h.sounds();
  await captureStill(h, "muted");

  // The mute bit really is on (specs/ui.md).
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

  // And nothing came out of it, heard either way.
  assertEqual(played.length, 0, "no sound on any tick driven while muted");
  assertEqual(
    totalAfter - totalBefore,
    0,
    "no sound anywhere across the muted stretch, driven or not",
  );
});
