// audio/cues — what the cue-identity points of this category share.
// CASE-PROVIDED.
//
// No review item names this file. Each function is either a compound sequence
// of the surface's atomic operations, which the authoring guide has live
// beside the checks rather than inside any one of them, or a reading over the
// log of named cues the engine's bus announced.
//
// WHAT THESE POINTS READ, AND WHY THEY RUN UNDER THIS ENGINE ALONE.
// `specs/ui.md` binds fifteen named cues to fifteen events — "Define and play
// exactly the fifteen cues below, under exactly these names, one per event" —
// and under this engine the game asks the engine's cue bus for a cue BY NAME,
// so the bus announces which one sounded and at what gain. A check here can
// therefore hold an event to the cue the specification bound to it, which is
// what `audio/fire-cue`, `audio/extraction-cue` and `audio/music-bed`
// deliberately do not do: those three cover every engine this case supports,
// the engineless one included, where the build owns its whole audio layer and
// a sound arriving at the Web Audio API carries no name at all. The manifest
// scopes the points here to the two engines whose runtime reports the
// identity.
//
// A POSE SOUNDS NOTHING. `specs/instrumentation.md`: "Audio belongs to the
// ticks. A pose changes the state alone and sounds nothing; the cues a
// scenario hears come from the ticks run after it." So every check here
// arranges by poses, steps, and reads what the stepped ticks sounded.
//
// THE TOLERANCE, EVERYWHERE HERE. None on the tick, and none would be honest:
// the specification fixes a cue to "the tick its event happens", the log reads
// whole ticks, and a build a tick out has broken the stated rule. The only
// spans these checks choose are drive lengths, which decide nothing.

import { assertEqual, assertLength } from "../assert";
import { CHANNEL_ARC, type ChargeId } from "../constants";
import {
  loopingSources,
  poseHall,
  startRun,
  stepUntilBed,
  stepUntilSound,
  type Harness,
  type PosedCore,
  type TimedCue,
} from "../harness";

/**
 * Where a lone core stands while a check reads a cue that is not about it.
 *
 * The middle of the leg from vertex 2 to vertex 3, which `specs/channel.md` runs
 * along `y = 500` at the bottom of the field, while `specs/injector.md` fixes the
 * injector at `(420, 330)` and every shot here flies UP from it — so the core
 * cannot be struck however far it advances, and an arc position this low is
 * nowhere near the intake at `s = 5000` nor the danger line at `s = 4000`.
 */
export const QUIET_S = (CHANNEL_ARC[2] + CHANNEL_ARC[3]) / 2;

/** Immaterial: no rule a cue check reads turns on which charge stands there. */
export const QUIET_CHARGE: ChargeId = "halide";

/** The lone core a quiet hall is posed with. */
export const QUIET_CORES: PosedCore[] = [[QUIET_S, QUIET_CHARGE, null]];

/**
 * Arm the audio, open a run, and let the music bed get up.
 *
 * A browser opens no audio context without a genuine gesture, so `armAudio`
 * delivers a real one at the engine's own input seam; the key it presses is bound
 * to nothing (`specs/controls.md`), so arming changes no game state. `specs/ui.md`
 * then loops a bed under `playing`, and its own start is a sound — so it is let up
 * BEFORE any check watches, and the ticks spent waiting for the produced `.wav` to
 * decode stay out of every scenario. A build whose bed is no looping source at all
 * fails `audio/music-bed`, which is the point about the bed; here the wait falls
 * back to any sound the hall makes rather than spending its whole budget.
 */
export async function openHall(h: Harness): Promise<void> {
  await h.armAudio();
  await startRun(h);
  const looping = await stepUntilBed(h);
  if (looping === 0) await stepUntilSound(h);
}

/** Open a run and pose a hall in which nothing but a check's own event sounds. */
export async function openQuietHall(h: Harness): Promise<void> {
  await openHall(h);
  await poseHall(h, { cores: QUIET_CORES });
}

/** The names of the cues that sounded on `tick`, in the order they sounded. */
export function namesOn(cues: readonly TimedCue[], tick: number): string[] {
  return cues.filter((cue) => cue.tick === tick).map((cue) => cue.cue);
}

/**
 * Assert `name` sounded exactly once on `tick`.
 *
 * `specs/ui.md`: "Each sounds on the tick its event happens, and at most once on
 * that tick." So the reading is a count of one rather than a presence: a build
 * that blips its cue every tick, one that sounds it a tick late, and one that
 * sounds it twice all fail here.
 */
export function assertHeardOnce(
  cues: readonly TimedCue[],
  tick: number,
  name: string,
  label: string,
): void {
  assertLength(
    cues.filter((cue) => cue.tick === tick && cue.cue === name),
    1,
    `${label} (the hall sounded [${namesOn(cues, tick).join(", ")}])`,
  );
}

/** Assert none of `names` sounded on `tick`. */
export function assertSilentOn(
  cues: readonly TimedCue[],
  tick: number,
  names: readonly string[],
  label: string,
): void {
  assertLength(
    cues.filter((cue) => cue.tick === tick && names.includes(cue.cue)),
    0,
    `${label} (the hall sounded [${namesOn(cues, tick).join(", ")}])`,
  );
}

/** The five extraction cues, one per chain step. */
export const EXTRACT_CUES = [
  "extract-1",
  "extract-2",
  "extract-3",
  "extract-4",
  "extract-5",
] as const;

/**
 * Assert exactly one bed is looping.
 *
 * `specs/ui.md`: "Exactly one of them is looping on `playing`, and neither loops
 * on any other screen", and on a swap "the running bed stops and the other starts
 * at once, so the two never sound together".
 */
export async function assertOneBedLooping(
  h: Harness,
  label: string,
): Promise<void> {
  assertEqual(await loopingSources(h), 1, label);
}
