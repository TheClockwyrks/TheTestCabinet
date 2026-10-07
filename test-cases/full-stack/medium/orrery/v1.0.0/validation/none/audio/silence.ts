// audio/silence — the quiet a cue is heard against, and the walk that finds the
// frame an event happened on.
//
// NOT A SUITE. No entry of `test-case.toml` names this file and it decides no
// point: it arranges, and the suite that called it reads the verdict. It is the
// same text in all three projects, like everything here that is not `harness.ts`
// or `surface.ts`.
//
// WHY THE AUDIO POINTS NEED AN ARRANGEMENT OF THEIR OWN. `specs/ui.md` fixes what
// a cue means — "played on the frame its event happens, from `update`, and at most
// once on that frame, however many of the event fired within it" — so every check
// here is about WHICH FRAME sounded, and a frame can only be read as having
// sounded against frames that did not. Two things stand in the way of that, and
// both are arranged away here rather than in twenty-two suites:
//
//   1. THE BED. "`music` is looping on every frame the game runs, on `title`,
//      `howto`, `select`, and `editor` alike, in every sim status", and a build
//      that loads its own produced sound decodes it asynchronously — so the bed
//      starts on whichever frame its file finished decoding on, which is a
//      property of the host rather than of the build. {@link openSilence} spends
//      frames until the build has stopped emitting anything at all, so what a
//      check hears afterwards is what the check itself caused.
//   2. THE NAME, UNDER NO ENGINE. `cuesOf` filters by name where a bus announces
//      one and answers EVERY sound where none does (`scenario.ts`), so a check
//      that leans on the name would read one thing under an engine and another
//      under none. Every check here therefore fences its window with silence and
//      reads FRAMES: the cue is heard as "this frame sounded and the frames
//      around it did not", which is the strongest reading all three engines can
//      make and the honest one on each.
//
// AND WHY A FRAME COUNT IS NEVER COMPARED AGAINST A LITERAL. Under no engine a
// single cue may be several sources — "a blip made of a tone and a noise burst is
// two sources and one cue" — so "exactly one cue" is not "exactly one sound". The
// checks that must tell one cue from two therefore compare ONE FRAME'S COUNT
// AGAINST ANOTHER'S, over the same build: a frame that fired the event twice
// sounds what a frame that fired it once sounds, whatever a cue costs in sources.
// {@link soundsOn} and {@link soundsOnFrame} are those readings, and which of the
// two a check wants turns on whether it is asking "did this cue sound" or "did
// anything sound beside it".

import { FRAMES_PER_CYCLE } from "../constants";
import {
  advanceFraction,
  cuesOf,
  cuesOnFrame,
  type Harness,
  type OrrerySnapshot,
  type TimedCue,
} from "../harness";

/**
 * How many frames a check runs either side of its window to show them silent.
 *
 * Long enough that a build cueing on a cadence of its own — every frame, every
 * other frame — is heard doing it, and short enough that a suite is a fraction of
 * a cycle either side of the moment it is about.
 */
export const FENCE_FRAMES = 6;

/**
 * How many frames past the one a KEY PRESS was delivered on the cue it raised may
 * land on.
 *
 * `specs/instrumentation.md`'s clock switch "keeps rendering and keeps reading the
 * keys" while the simulation is held, so under no engine the press is read by the
 * build's own loop frame and the cue it raised is played from the next `update` —
 * the next frame the harness drives. Under either engine the press is read inside
 * that frame and the cue sounds on it. Both are `specs/ui.md`'s "played on the
 * frame its event happens, from `update`"; which driven frame that is depends on
 * which of the two the build reads its keys in, so a check that presses a key
 * reads the pair of frames and a check that poses through the surface — where the
 * edit commits between frames, and "sounds on the next frame advanced rather than
 * at the call" — reads the one frame exactly.
 */
export const PRESS_LAG = 1;

/** How many frames a check runs after its window to show nothing sounds again. */
export const TAIL_FRAMES = 8;

/** How many frames {@link openSilence} spends before giving up on a quiet build. */
const SILENCE_BOUND = 240;

/**
 * Run frames until the build has fallen silent, so the window a check opens next
 * is one the check itself fills.
 *
 * EXPECTS AN ARMED HARNESS — one created with `{ armAudio: true }`. A browser
 * opens no audio context without a user gesture and a build is free to open its
 * own from a real DOM event alone, so a harness that was never handed one is
 * silent whatever the build does, and the quiet this walk finds would be the
 * page's rather than the build's. The gesture cannot be given here: it is a
 * genuine key press, which the game is entitled to act on, and the only moment
 * that is safe is before the harness's opening `reset` — so it belongs to the
 * creation the caller makes, not to an arrangement running inside a check.
 *
 * Nothing is asserted: a build that never falls quiet spends the bound and leaves
 * its noise to the check's own fence, where it is reported against the point it
 * belongs to rather than inside a helper.
 */
export async function openSilence(h: Harness): Promise<void> {
  let quiet = 0;
  for (
    let frame = 0;
    frame < SILENCE_BOUND && quiet < FENCE_FRAMES;
    frame += 1
  ) {
    const before = await h.sounds();
    await h.advance(1);
    quiet = (await h.sounds()) === before ? quiet + 1 : 0;
  }
}

/**
 * The frames of `played` that `cue` sounded on, ascending and without repeats.
 *
 * One entry per FRAME rather than per sound, because a cue is one sound to a
 * listener and may be several sources to a browser. Under either engine this is
 * the frames the bus announced `cue` on; under no engine it is the frames the
 * build emitted anything on, which is why a check fences its window.
 */
export function soundingFrames(
  played: readonly TimedCue[],
  cue: string,
): number[] {
  const frames = new Set<number>();
  for (const entry of cuesOf(played, cue)) frames.add(entry.frame);
  return [...frames].sort((a, b) => a - b);
}

/**
 * How many sounds of `cue` reached `played` on one frame.
 *
 * Only ever compared against another frame's figure, never against a literal: one
 * cue costs a build however many sources it costs, and what a check about "at most
 * once on that frame, however many of the event fired within it" reads is that a
 * frame which fired the event several times cost what a frame that fired it once
 * cost.
 */
export function soundsOn(
  played: readonly TimedCue[],
  cue: string,
  frame: number,
): number {
  return cuesOf(played, cue).filter((entry) => entry.frame === frame).length;
}

/**
 * How much one frame sounded ALTOGETHER: every cue that reached `played` on it,
 * whatever it was.
 *
 * The reading for a check about a frame that must carry ONE cue and not two.
 * {@link soundsOn} reads the name where there is one, which is the right reading
 * for "did this cue sound"; it is the wrong one for "did anything else sound
 * beside it", because a second cue announced under another name passes a filter
 * that is looking for the first. This is deliberately blind to the name, so a
 * frame that sounded `erase` and `place` together is read as louder than a frame
 * that sounded one of them — on all three engines, since under no engine there is
 * no name to read in any case.
 *
 * Compared against another frame's figure, never against a literal, for the
 * reason {@link soundsOn} gives.
 */
export function soundsOnFrame(
  played: readonly TimedCue[],
  frame: number,
): number {
  return cuesOnFrame(played, frame).length;
}

/**
 * Run one frame at a time until `predicate` holds, and answer the frame it first
 * held on — `0` when it never did.
 *
 * Each frame is worth `1 / FRAMES_PER_CYCLE` of a cycle at the run's own speed,
 * which is the cadence `advanceCycles` divides a cycle into, so a check that
 * drives this way and one that drives whole cycles see the same simulation. What
 * it is for is the checks whose moment is a STATE CHANGE rather than a call — the
 * frame `sim.status` became `faulted`, the frame a tally rose — since
 * `specs/ui.md` plays the cue on the frame its event happens and the check has to
 * name that frame to read the cue against it.
 */
export async function driveUntil(
  h: Harness,
  predicate: (snapshot: OrrerySnapshot) => boolean,
  cycles = 2,
): Promise<number> {
  const bound = Math.max(1, Math.round(cycles * FRAMES_PER_CYCLE));
  for (let frame = 0; frame < bound; frame += 1) {
    await advanceFraction(h, 1 / FRAMES_PER_CYCLE, 1);
    if (predicate(await h.snapshot())) return h.frame();
  }
  return 0;
}
