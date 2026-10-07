// Floe — audio/mute-produces-no-sound: with the mute bit on, a quarter second of
// held strait, an accepted hop and a filled bay emit nothing at all.
//
// `specs/ui.md` states the rule beside the ten cues: the mute action "silences
// every cue", and "the game stays fully playable with sound muted". This point is
// the SILENCE half of it. The playability half is `audio/mute-silences`, which
// runs under every engine; that the two events sound at all when the game is not
// muted is `audio/cue-hop` and `audio/cue-bay`.
//
// `engines = ["none"]`, BECAUSE ONLY AN ENGINELESS BUILD OWNS ITS AUDIO. Here the
// build writes the whole audio layer, so whether a muted game reaches the output
// at all is its own work and is worth reading. Under either engine the mute bit
// is the engine's and its cue bus reports `gain: 0` for anything played on a
// muted bus, so "nothing sounded above zero gain" holds for every build on that
// engine and would grade the engine rather than the build.
//
// SILENCE IS READ BOTH WAYS THE HARNESS CAN HEAR IT. `watchCues` attributes an
// emission to the driven call that produced it, which catches anything the
// simulation sounded; `sounds()` is the page's running total, which catches an
// emission a build makes outside a driven call — from a key handler, say. A
// muted stretch has to be silent by both. See `audio/cue-hop` for what "an
// emission" is and why it is what an engineless build can be heard by at all.
//
// MUTE IS REACHED THE WAY A PLAYER REACHES IT. `specs/instrumentation.md` gives
// the surface no operation for muting on purpose — "muting is reached the same
// way a player reaches it, through the mute action `specs/controls.md` fixes" —
// so the key is really pressed. That the key TOGGLES the bit is
// `controls/mute-m`'s point; the snapshot is read here only as the situation the
// silence was heard in.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BAYFILL_PAUSE, BAYS, BINDINGS, WATER_TOP } from "../constants";
import {
  captureStill,
  createHarness,
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
 * the fresh crossing it leads to is inside it too — which is where the level-clear
 * and fresh-crossing cues of a build that is not muted would fall. A build that
 * sounds late is still inside it.
 */
const SETTLE_TICKS = ticksPast(BAYFILL_PAUSE) + ticksFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("emits nothing at all while muted", async () => {
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

  // An accepted hop along the raft, then a hop up into the open bay, which ends
  // the crossing — two events `specs/ui.md` gives a cue each.
  await hop(h, "right");
  await hop(h, "up");
  const filled = await h.snapshot();

  await h.advance(SETTLE_TICKS);

  const totalAfter = await h.sounds();
  await captureStill(h, "silent");

  // The situation the silence was heard in: the game really was muted, and the
  // two events that carry cues really happened.
  assertEqual(
    muted.muted,
    true,
    "the runtime's mute bit on across the stretch that follows (specs/ui.md)",
  );
  assertDeepEqual(
    filled.bays,
    BAYS.map((_, index) => index === BAY_INDEX),
    "the muted hop into the bay filled it, and no other",
  );

  // And nothing came out of it, heard either way.
  assertEqual(played.length, 0, "no sound on any tick driven while muted");
  assertEqual(
    totalAfter - totalBefore,
    0,
    "no sound anywhere across the muted stretch, driven or not",
  );

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(h.pageErrors, []);
});
