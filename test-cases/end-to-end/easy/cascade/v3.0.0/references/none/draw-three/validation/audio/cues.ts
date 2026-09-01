// audio/cues — what this group can hear, and the gestures its points raise their
// events with. CASE-PROVIDED.
//
// WHAT CAN BE READ FROM OUTSIDE AN ENGINELESS BUILD, AND WHY THAT IS THE FAIR
// READING. Under an engine the cue bus is the engine's: the game asks for
// `CUES.home` BY NAME and the bus announces the play, so a check reads the name,
// the frame and the gain. There is no bus here to ask — `specs/audio.md` hands
// the whole audio layer to the build, which "synthesiz[es] its sounds with the
// Web Audio API" itself — so what is observed is the SOUND. `audio-init.js` is
// injected before a line of the build's own script runs and wraps the two doors
// a browser can emit sound through: a Web Audio source node being `start()`ed,
// whatever kind it is, and an `<audio>` element being played. The harness
// brackets every driven frame around that count, so a sound is attributed to the
// frame that produced it (`watchCues`).
//
// NOTHING ABOUT THE SYNTHESIS IS ASSUMED. Not the waveform, not the envelope,
// not the duration, not the gain, and not the number of sources one cue is made
// of — `specs/audio.md` fixes none of them, and a blip built from a tone and a
// noise burst is two sources and one cue. So a point here asks WHETHER a frame
// sounded and WHICH frame, never how loudly.
//
// WHAT IS THEREFORE ASSERTED. `specs/audio.md`: each cue "is played on the frame
// its event happens and at most once on that frame; a frame that raises more
// than one of them plays each of those once." So a point drives its event on an
// otherwise silent table and holds that the event's own frame sounded and that
// no other frame of the drive did. That separates a build that cues the event
// from one that cues nothing, one that cues a frame late, and one that blips
// every frame.
//
// FOUR POINTS READ A COUNT RATHER THAN A PRESENCE, because their event cannot be
// raised alone. `flip`, `home` and `win` only ever happen on the back of an
// accepted move, which raises `drop` on the same frame, so those three are
// decided by the second half of the sentence above: a frame raising two cues
// sounds both, so a frame carrying drop AND home must emit strictly more than a
// frame carrying drop alone. Each of the three drives the SAME gesture twice,
// once with its event and once without, and compares the two release frames.
// This is a count, never a name.
//
// WHAT IS NOT ASSERTED, AND CANNOT BE. The cue's NAME. A build that plays its
// reject buzz on every card sent home is not caught here, because the name is
// unobservable from outside an engineless build and inferring a cue from the
// waveform the reference happens to use would grade builds against an
// implementation rather than against the specification. NO POINT IN THIS PROJECT
// MAY ASSERT A CUE NAME; whether the ten are told apart by ear is what the
// `presentation` domain rating is for.
//
// EVERY EVENT IS RAISED WITH THE REAL MOUSE, never with the surface's pointer
// operations, and never with `deal()`, `turnStock()` or `move()`. A cue is
// "played on the frame its event happens" (`specs/audio.md`), and an event
// raised from a debug operation happens BETWEEN frames: a build that plays it at
// once emits outside every driven frame, and a build that holds it until the
// next update emits a frame later. Both are conformant and neither can be read.
// A player's gesture has no such ambiguity — `specs/controls.md` has every
// sample a frame delivers answered inside that frame — so each point hands the
// build a genuine Chromium press, glide and release and reads the frame the
// build's own rules resolved it on.
//
// AUDIO IS ARMED WITH A REAL KEY FIRST. A browser will not open an audio context
// without a user gesture, and a build is free to open its own only from a
// genuine DOM event, so every point calls `h.armAudio()` — a press of
// `UNBOUND_KEY`, which `specs/controls.md` binds to nothing, delivered through
// Chromium's own input pipeline, and which disturbs no game state.
//
// THE MOVES BELOW ARE ARRANGEMENT, NOT VERDICTS. NOT ONE THRESHOLD IS DECIDED IN
// THIS FILE: the one ceiling below bounds a build that never does the thing at
// all, and each point states its own reading itself.

import { fail } from "../assert";
import {
  cardCenter,
  framesFor,
  mouseGlide,
  mousePress,
  mouseRelease,
  type CascadeSnapshot,
  type Harness,
  type Point,
  type TimedCue,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Reading the sounds                                                         */
/* -------------------------------------------------------------------------- */

/** How many sounds the build emitted on `frame`. */
export function soundsOn(played: readonly TimedCue[], frame: number): number {
  return played.filter((cue) => cue.frame === frame).length;
}

/**
 * The frames of every sound that landed on none of `frames`.
 *
 * Empty is what a point requires; anything else names the frames a build
 * sounded on that carried none of the events it was allowed to sound for.
 */
export function framesApartFrom(
  played: readonly TimedCue[],
  frames: readonly number[],
): number[] {
  return played
    .filter((cue) => !frames.includes(cue.frame))
    .map((cue) => cue.frame);
}

/* -------------------------------------------------------------------------- */
/* Raising the events                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How long a build is given to do the thing at all, in frames.
 *
 * A CEILING, NOT A TOLERANCE. `specs/controls.md` answers every sample inside
 * the frame that delivered it, so in a conforming build every gesture below
 * resolves on its own frame and this is never approached — and each point reads
 * the frame the event ACTUALLY happened on rather than a frame this file
 * predicted, so widening it changes no verdict. What it bounds is the cost of a
 * build that never lifts, never drops, or never turns the stock.
 */
export const NEVER_HAPPENED = framesFor(0.25);

/** A driven frame an event happened on, and whether it happened at all. */
export interface Raised {
  /** Whether the event ever happened inside {@link NEVER_HAPPENED}. */
  hit: boolean;
  /** The frame it happened on, 1-based, as {@link Harness.frame} counts them. */
  frame: number;
  /** The state that frame left. */
  snapshot: CascadeSnapshot;
}

/**
 * Run frames until `done` holds, and answer with the frame it held on.
 *
 * The predicate has to be FALSE when this is called, because the frame it
 * reports is the frame the state CHANGED on; a predicate that already held would
 * name a frame the event did not happen on. That is a mistake in the point, not
 * a verdict on the build, so it fails loudly rather than quietly.
 */
export async function frameOf(
  h: Harness,
  done: (snapshot: CascadeSnapshot) => boolean,
  maxFrames = NEVER_HAPPENED,
): Promise<Raised> {
  const result = await h.until(done, { maxFrames, poll: 1 });
  if (result.hit && result.frames === 0 && h.frame() === 0) {
    fail("a driven frame to read the event on", "no frame had run yet");
  }
  return { hit: result.hit, frame: h.frame(), snapshot: result.snapshot };
}

/** What a real drag did, and the two frames of it that are allowed to sound. */
export interface Dropped {
  /** Whether the press put a run in the hand. */
  lifted: boolean;
  /** The frame the run entered the hand on. */
  liftFrame: number;
  /** Whether the release ever took the run out of the hand. */
  resolved: boolean;
  /** The frame the release resolved on. */
  dropFrame: number;
  /** The state the release left. */
  snapshot: CascadeSnapshot;
}

/**
 * Press a card with the REAL mouse, carry it until its centre lies on `centre`,
 * release it there, and answer with the frames the press and the release
 * resolved on.
 *
 * The run keeps the offset between the press point and the leading card's
 * top-left for the whole gesture (`specs/controls.md`), so the release point is
 * the press point shifted by however far that card's centre has to travel. The
 * offset is measured from the run the BUILD reports after the press, exactly as
 * the shared harness's `dragRunTo` measures it, so a build that lifts a run at
 * some other offset is still carried to the target this names rather than
 * failing an audio point for a handling one.
 *
 * A drop resolves against the centre of the run's leading card rather than
 * against the pointer (`specs/controls.md`), which is why the caller names a
 * centre and not a release point.
 *
 * The press, the two glides and the release each get a frame of their own, so a
 * point can say which frame it allows a sound on. A press that lifted nothing is
 * reported rather than thrown on, because a build that lifts nothing is a
 * verdict for the point to state.
 */
export async function realDrop(
  h: Harness,
  press: Point,
  centre: Point,
): Promise<Dropped> {
  if ((await h.snapshot()).drag !== null) {
    fail(
      "nothing in hand when the drag begins, so the frame the run enters it is readable",
      "a run was already held",
    );
  }

  await mousePress(h, press.x, press.y);
  const lift = await frameOf(h, (s) => s.drag !== null);

  const held = lift.snapshot.drag;
  const carried =
    held === null
      ? press
      : (() => {
          const at = cardCenter(held.x, held.y);
          return {
            x: press.x + (centre.x - at.x),
            y: press.y + (centre.y - at.y),
          };
        })();

  await mouseGlide(h, (press.x + carried.x) / 2, (press.y + carried.y) / 2);
  await mouseGlide(h, carried.x, carried.y);

  await mouseRelease(h);
  const settled = await frameOf(h, (s) => s.drag === null);

  return {
    lifted: lift.hit,
    liftFrame: lift.frame,
    resolved: settled.hit,
    dropFrame: settled.frame,
    snapshot: settled.snapshot,
  };
}

/**
 * Press and release the real mouse at one point, which `specs/controls.md` makes
 * a CLICK rather than a drop because the release lies on the press, and answer
 * with the frame the click's own effect landed on.
 *
 * The gesture that activates a control and turns the stock. The press gets a
 * frame of its own, and every point using this requires that frame to be silent:
 * `specs/audio.md` gives a press on a control and a press on the stock no cue of
 * their own, so only the click's own effect may sound.
 */
export async function realClick(
  h: Harness,
  at: Point,
  done: (snapshot: CascadeSnapshot) => boolean,
): Promise<Raised> {
  await mousePress(h, at.x, at.y);
  await mouseRelease(h);
  return frameOf(h, done);
}
