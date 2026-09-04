// audio/cues — what this group can hear, and the three compound moves its points
// raise their events with. CASE-PROVIDED.
//
// WHAT CAN BE READ FROM OUTSIDE AN ENGINELESS BUILD, AND WHY THAT IS THE FAIR
// READING. Under an engine the cue bus is the engine's: the game asks for
// `CUES.fire` BY NAME and the bus announces the play, so a check reads the name,
// the frame and the gain. There is no bus here to ask — `specs/ui.md` hands the
// whole audio layer to the build, which "synthesiz[es] its sounds with the Web
// Audio API" itself — so what is observed is the SOUND. `audio-init.js` is
// injected before a line of the build's own script runs and wraps the two doors
// a browser can emit sound through: a Web Audio source node being `start()`ed,
// whatever kind it is, and an `<audio>` element being played. The harness
// brackets every driven frame around that count, so a sound is attributed to the
// frame that produced it (`watchCues`).
//
// NOTHING ABOUT THE SYNTHESIS IS ASSUMED. Not the waveform, not the envelope,
// not the duration, not the gain, and not the number of sources one cue is made
// of — `specs/ui.md` fixes none of them, and a blip built from a tone and a noise
// burst is two sources and one cue. So a point here asks WHETHER a frame sounded
// and WHICH frame, never how loudly or how many times.
//
// WHAT IS THEREFORE ASSERTED, ACROSS ALL ELEVEN POINTS. `specs/ui.md`: each cue
// "is played on the frame its event happens and at most once on that frame; a
// frame that raises more than one of them plays each of those once." So a point
// drives its event on an otherwise silent board and holds that the event's frame
// sounded and that no other frame of the drive did. That separates a build that
// cues the event from one that cues nothing, one that cues a frame late, and one
// that blips every frame.
//
// WHAT IS NOT ASSERTED, AND CANNOT BE. The cue's NAME. A build that plays its
// menu click on every shot is not caught here, because the name is unobservable
// from outside an engineless build and inferring a cue from the waveform the
// reference happens to use would grade builds against an implementation rather
// than against the specification. NO POINT IN THIS PROJECT MAY ASSERT A CUE
// NAME; whether the ten are told apart by ear is what the `presentation` domain
// rating is for. `audio/level-clear` is the one point that reaches past presence,
// and it does so by COUNTING rather than by naming: `specs/ui.md` makes a frame
// that raises two cues play both, so a frame carrying cut AND level-clear must
// emit strictly more sound than a frame carrying cut alone.
//
// AUDIO IS ARMED WITH A REAL KEY FIRST. A browser will not open an audio context
// without a user gesture, and a build is free to open its own only from a genuine
// DOM event, so every point calls `h.armAudio()` — a press of a key
// `specs/controls.md` binds to nothing, delivered through Chromium's own input
// pipeline, which disturbs no game state.
//
// THE MOVES BELOW ARE ARRANGEMENT, NOT VERDICTS. Each is a sequence of the
// atomic operations `specs/instrumentation.md` gives the surface, in the shape
// `guides/authoring/writing-debug-apis-and-validators.md` asks for. They live
// here rather than in the shared harness because raising an event in order to
// listen to it is this group's own subject. NOT ONE THRESHOLD IS DECIDED IN THIS
// FILE: the ceilings below bound a build that never does the thing at all, and
// each point states its own reading itself.

import { BAND_CX, BAND_CY, colAt, rowAt } from "../constants";
import {
  framesFor,
  poseBolt,
  poseWorm,
  segmentTiles,
  type Harness,
  type Tile,
  type TimedCue,
  type UntilResult,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Reading the sounds                                                         */
/* -------------------------------------------------------------------------- */

/** How many sounds the build emitted on `frame`. */
export function soundsOn(played: readonly TimedCue[], frame: number): number {
  return played.filter((cue) => cue.frame === frame).length;
}

/**
 * The frames of every sound that did NOT land on `frame`.
 *
 * Empty is what a point requires; anything else names the frames a build
 * sounded on that its event did not happen on.
 */
export function framesOtherThan(
  played: readonly TimedCue[],
  frame: number,
): number[] {
  return played.filter((cue) => cue.frame !== frame).map((cue) => cue.frame);
}

/* -------------------------------------------------------------------------- */
/* Raising the events                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How long a build is given to do the thing at all, in frames.
 *
 * A CEILING, NOT A TOLERANCE. Every event below happens on the first frame that
 * can carry it in a conforming build, and each point reads the frame it actually
 * happened on rather than a frame this file predicted — so widening these
 * changes no verdict. What they bound is the cost of a build that never fires,
 * never moves its highlight, or never resolves a shot.
 */
const NEVER_HAPPENED = framesFor(1);

/**
 * Hold the fire action until a bolt is in flight, then let it go.
 *
 * `specs/cursor.md`: "While the fire action is held, a bolt is fired whenever the
 * cooldown is at `0` and fewer than `MAX_BOLTS` bolts are in flight". The key is
 * a real one through Chromium's input pipeline, and the sweep stops on the frame
 * the bolt APPEARS — which is the frame `specs/ui.md` puts the fire cue on — so
 * the reading never depends on how many frames a build's own keyboard layer
 * takes to see a press. Exactly one bolt is fired: the action is released the
 * moment the first one exists, long inside `FIRE_INTERVAL`.
 */
export async function fireBolt(h: Harness): Promise<UntilResult> {
  await h.hold("Space");
  try {
    return await h.until((snapshot) => snapshot.bolts.length > 0, {
      maxFrames: NEVER_HAPPENED,
      poll: 1,
    });
  } finally {
    await h.release("Space");
  }
}

/**
 * Move the highlight of whatever menu is on screen down by one, and let the key
 * go the moment it moves.
 *
 * `specs/controls.md`, Menus: "`up` and `down` move the highlight by one item and
 * wrap at both ends". The action is released as soon as the highlight has moved,
 * so exactly one move happens whether a build reads the movement action as a
 * press edge or repeats it while held — the specification fixes neither, and a
 * point here must not decide it.
 */
export async function moveHighlight(h: Harness): Promise<UntilResult> {
  const from = (await h.snapshot()).menuIndex;
  await h.hold("ArrowDown");
  try {
    return await h.until((snapshot) => snapshot.menuIndex !== from, {
      maxFrames: NEVER_HAPPENED,
      poll: 1,
    });
  } finally {
    await h.release("ArrowDown");
  }
}

/**
 * Put a bolt in the column beneath `tile` and run the real simulation until a
 * worm segment has left the board.
 *
 * `addBolt` puts a bolt in flight and "it then travels and resolves through the
 * game's own shot rules" (`specs/instrumentation.md`), and `specs/cursor.md` has
 * it resolve "against the first thing its center reaches" — so on a board whose
 * column carries nothing but the target, the build's own shot code is what
 * destroys the segment. The sweep stops on the frame the segment is REMOVED,
 * which is the frame `specs/ui.md` puts the cut cue on.
 */
export async function shootSegment(
  h: Harness,
  tile: Tile,
): Promise<UntilResult> {
  const standing = segmentTiles(await h.snapshot()).length;
  await poseBolt(h, tile.c, tile.r + 1);
  return h.until((snapshot) => segmentTiles(snapshot).length < standing, {
    maxFrames: NEVER_HAPPENED,
    poll: 1,
  });
}

/**
 * The tile a worm segment stands on to reach a cursor parked at the band's
 * centre.
 *
 * `specs/cursor.md` makes contact an overlap: the cursor's box is `CURSOR_HALF`
 * (`12`) units from its centre on each axis, and "a worm segment reaches the
 * cursor when the segment's tile overlaps the cursor's box". The band's centre
 * `(640, 688)` sits on the top-left corner of this tile, so the tile covers the
 * lower-right quarter of that box.
 */
export const CONTACT_TILE: Tile = { c: colAt(BAND_CX), r: rowAt(BAND_CY) };

/**
 * Put one worm segment inside the cursor's box, open the cursor's contact test,
 * and run the one frame that reads it.
 *
 * The segment is a worm of ONE segment with its step faculty off: what the
 * contact SOUNDS LIKE is the subject, not how a worm walks into one, and a worm
 * that cannot step cannot walk back out of the box between the pose and the
 * reading. `setCursorContact(true)` is the gate these two points are allowed to
 * open, because the contact is the event they are about; `startPlaying` shuts it
 * and this opens it at the last moment, so nothing posed earlier could have cost
 * a life while the board was supposed to be quiet.
 */
export async function contactCursor(h: Harness): Promise<void> {
  await poseWorm(h, {
    c: CONTACT_TILE.c,
    r: CONTACT_TILE.r,
    length: 1,
    stepping: false,
  });
  await h.debug.setCursorContact(true);
  await h.advance(1);
}
