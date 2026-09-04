// Volute — audio/fire-cue: a cue sounds on the tick the injector fires, and on
// no tick of the probe before it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/ui.md` ("Audio"): the cue table binds `fire` to "The injector fires
//     a core", and the paragraph under it fixes WHEN: "Each sounds on the tick
//     its event happens, and at most once on that tick."
//   - `specs/controls.md` ("Actions"): the action that fires is read as an edge
//     and `Space` is a key bound to it, and the engine arms an edge at the event
//     and discards it after the frame that could have consumed it, so the tick
//     the key goes down is the tick the injector fires.
//   - `specs/instrumentation.md` ("A deterministic core"): "Audio belongs to the
//     ticks. A pose changes the state alone and sounds nothing; the cues a
//     scenario hears come from the ticks run after it." So the hall is arranged
//     by poses, which sound nothing, and every cue read below comes from a
//     stepped tick.
//
// WHAT IS READ. The engine's cue bus announces every play at the moment it
// happens, and the harness stamps each announcement with the tick that was
// running, so what is asserted is that a sound was emitted and on WHICH tick.
// That separates a build that sounds the shot from one that is silent, one that
// sounds it a tick late, and one that blips on every tick. Nothing about
// waveform, envelope or duration is assumed, because the specification fixes none
// of them.
//
// THE CUE'S NAME IS NOT ASSERTED HERE, THOUGH THIS ENGINE OFFERS IT. This point
// covers all three engines the case supports, and an engineless build owns its
// whole audio layer with no bus to ask which cue played — so the reading here is
// the one every engine can make, and a score recorded under one engine stays
// comparable with a score recorded under another. The identity is decided by
// `audio/fire-cue-named` beside this file, which the manifest scopes to the two
// engines whose bus reports it.
//
// THE HALL IS POSED SO THAT ONLY THE SHOT CAN SOUND. An EMPTY channel, pressure
// 0, and the inlet held by `poseHall`'s `setEmission(false)` with the level's
// quota left where it stands. Nothing else in `specs/ui.md`'s cue table can fire:
// no insertion or extraction (there is nothing to strike and nothing to draw
// out), no intake arrival (there is no core to reach `s = 5000`), no clear ("A
// level is cleared the moment its quota is EXHAUSTED and no cores remain on the
// channel" — the quota is not exhausted, so the empty channel clears nothing), no
// emission, no grant, and no swap. Every sound the probe hears therefore belongs
// to the shot, and no core has to stand anywhere to keep the hall in play.
//
// AUDIO IS ARMED WITH A KEY FIRST, and the bed is left to start BEFORE the probe
// opens. "Muting and the first-gesture unlock belong to the engine", which opens
// its audio context on the first key or pointer event it sees, so `armAudio`
// presses `KeyZ` — a key bound to nothing — at the engine's own event target. And
// `specs/ui.md` has a music bed looping under `playing`, whose own start is a
// sound; the probe is opened only once that bed is up, so the bed's start is
// never mistaken for the shot's cue.
//
// TOLERANCE. None, and none would be honest. The specification fixes the cue to
// "the tick its event happens", the probe reads whole ticks, and the fire edge is
// consumed on the tick the key goes down — so the expected tick is exact and a
// build one tick out is a build that broke the stated rule. The only span chosen
// here is the length of the silent probe before the shot (30 ticks, half a
// second, as the review item's own drive states), which is a drive length rather
// than a threshold: it is long enough that a build blipping per tick, or on a
// timer, is caught, and short enough to sit inside one music bed's play.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  driveShot,
  poseHall,
  pressFire,
  startRun,
  stepUntilBed,
  stepUntilSound,
  watchCues,
  type Harness,
} from "../harness";

/**
 * The silent stretch driven before the shot, in ticks.
 *
 * The review item's drive: "step 30 ticks with nothing raising a cue, fire once".
 * Half a second of a hall posed to raise no cue at all, which is what makes "and
 * on no tick before it" a real reading rather than a formality.
 */
const QUIET_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue on the tick the injector fires, and on no tick before it", async () => {
  await h.armAudio();
  await startRun(h);

  // Let the bed get up BEFORE the hall is posed and the probe opened. A produced
  // `.wav` decodes asynchronously (`specs/assets.md` has the build load its own
  // files), so the tick a conformant build's bed starts on is a fact about the
  // host's decode rather than about the build; this steps one tick at a time
  // until it is running, and doing it here keeps those ticks out of the scenario
  // entirely. A build that runs its bed by re-scheduling the buffer end to end
  // rather than by setting `loop` is equally conformant and reports no looping
  // source, so the weaker reading follows for it.
  const looping = await stepUntilBed(h);
  if (looping === 0) await stepUntilSound(h);

  await poseHall(h);

  // Watched from here, so what is read is the quiet stretch and the shot alone.
  const played = watchCues(h);
  const shot = await captureReplay(h, "fire", async () => {
    await h.step(QUIET_TICKS);
    const quiet = [...played];
    const after = await pressFire(h);
    // Read HERE, on the firing tick: the tick number and the sounds emitted by
    // then are exactly what the assertions read, before the flight below is
    // recorded. The item's evidence is "the shot whose cue is checked", and a
    // shot is the hall before it, the release, and the core flying away.
    const measured = { quiet, after, tick: h.tick(), cues: [...played] };
    await driveShot(h);
    return measured;
  });

  assertEqual(
    shot.quiet.length,
    0,
    "the sounds the hall emitted over the 30 quiet ticks before the shot",
  );
  assertGreaterThan(
    (shot.after.projectiles ?? []).length,
    0,
    "the projectiles the fire control put in the hall",
  );
  assertGreaterThan(
    shot.cues.length,
    0,
    "the sounds the hall had emitted by the firing tick",
  );
  assertDeepEqual(
    shot.cues.map((cue) => cue.tick),
    shot.cues.map(() => shot.tick),
    "the ticks the hall's sounds sounded on, against the firing tick",
  );
});
