// Volute — audio/fire-cue: a cue sounds on the tick the injector fires, and on
// no tick of the probe before it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/ui.md` ("Audio"): the cue table binds `fire` to "The injector fires
//     a core", and the paragraph under it fixes WHEN: "Each sounds on the tick
//     its event happens, and at most once on that tick."
//   - `specs/controls.md` ("Actions and bindings"): fire is bound to `Space`,
//     read as an edge — "true once for the frame in which the held value became
//     true" — so the tick the key goes down is the tick the injector fires.
//   - `specs/instrumentation.md` ("A deterministic core"): "Audio belongs to the
//     ticks. A pose changes the state alone and sounds nothing; the cues a
//     scenario hears come from the ticks run after it." So the hall is arranged
//     by poses, which sound nothing, and every cue read below comes from a
//     stepped tick.
//
// WHAT CAN BE READ FROM OUTSIDE AN ENGINELESS BUILD. There is no cue bus here to
// ask: `specs/ui.md` hands the whole audio layer to the runtime this build
// writes, so the fifteen cue NAMES live inside the build's own code and nothing
// outside can read one. `audio-init.js` therefore watches the two doors a browser
// can emit sound through — a Web Audio source node being `start()`ed, whatever
// kind it is, and an `<audio>` element being played — and the harness brackets
// each stepped tick around that count, so a sound is attributed to the tick that
// produced it. Nothing about waveform, envelope, duration or the NUMBER of
// sources is assumed, because the specification fixes none of them: a blip made
// of a tone and a noise burst is two sources and one cue.
//
// So what is asserted is that a sound was emitted, and on WHICH tick. That
// separates a build that sounds the shot from one that is silent, one that sounds
// it a tick late, and one that blips on every tick. It cannot separate a build
// that plays the WRONG cue on the right event; that half is the reviewer's, by
// ear, and inferring the cue from the waveform the reference happens to use would
// grade builds against an implementation rather than against the specification.
//
// THE HALL IS POSED SO THAT ONLY THE SHOT CAN SOUND. One lone core, the inlet
// stopped (`quotaRemaining` 0), pressure 0, and the core parked on the bottom run
// far from the shot's path. Nothing else in `specs/ui.md`'s cue table can fire:
// no insertion (nothing is struck), no extraction (`MIN_RUN` is 3 and there is
// one core), no intake arrival (the core is nowhere near `s = 5000`), no clear
// ("A level is cleared the moment its quota is exhausted AND no cores remain on
// the channel" — a core remains, so the level never clears, which is exactly why
// the hall is not posed empty), no emission, no grant, and no swap. Every sound
// the probe hears therefore belongs to the shot.
//
// THE HARNESS IS CREATED ARMED, and the bed is left to start BEFORE the probe
// opens. A browser opens no audio context without a genuine user gesture, so
// `createHarness({ armAudio: true })` presses `KeyZ` — a key `specs/controls.md`
// binds to nothing — through Chromium's own input pipeline, and delivers it
// before the harness's opening `reset`. That ordering is what makes the gesture
// cost this check nothing: the reset restores every declared field of the state,
// so whatever the press moved is gone before the hall below is posed, while the
// audio it opened is a fact about the page's user activation that no reset
// touches. And `specs/ui.md` has a music bed looping under `playing`, whose own
// start is a sound; the probe is opened only once that bed is up, so the bed's
// start is never mistaken for the shot's cue.
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
import { CHANNEL_ARC, type ChargeId } from "../constants";
import {
  captureReplay,
  createHarness,
  driveShot,
  poseHall,
  pressFire,
  spacedBlock,
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

/**
 * Where the lone core stands: the middle of the leg from vertex 2 to vertex 3.
 *
 * `specs/channel.md` runs that leg along `y = 500`, the bottom of the field,
 * while `specs/injector.md` fixes the injector at `(420, 330)` and this shot
 * flies UP from it — so the core cannot be struck however far it advances during
 * the drive, and at an arc position this low it is nowhere near the intake at
 * `s = 5000` nor the danger line at `s = 4000`. It is here at all only because a
 * hall with NO core clears the moment the tick runs, which would move the game
 * off `playing` and stop the bed.
 */
const QUIET_S = (CHANNEL_ARC[2] + CHANNEL_ARC[3]) / 2;

/** Immaterial: no rule here turns on which of the five charges is posed. */
const QUIET_CHARGE: ChargeId = "halide";

let h: Harness;

beforeEach(async () => {
  // Armed, because the only check in this file reads what the build SOUNDED.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue on the tick the injector fires, and on no tick before it", async () => {
  await startRun(h);

  // Let the bed get up BEFORE the hall is posed and the probe opened. A produced
  // `.wav` decodes asynchronously (`specs/assets.md` has the build load its own
  // files), so the tick a conformant build's bed starts on is a fact about the
  // host's decode rather than about the build; this steps one tick per crossing
  // until it is running, and doing it here keeps those ticks out of the scenario
  // entirely. A build that runs its bed by re-scheduling the buffer end to end
  // rather than by setting `loop` is equally conformant and reports no looping
  // source, so the weaker reading follows for it.
  const looping = await stepUntilBed(h);
  if (looping === 0) await stepUntilSound(h);

  await poseHall(h, { cores: spacedBlock(QUIET_S, 1, QUIET_CHARGE) });

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
