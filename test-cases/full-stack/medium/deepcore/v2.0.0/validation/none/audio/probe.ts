// Deepcore — arming the build's audio, and counting what it emits. CASE-PROVIDED.
//
// WHAT THESE POINTS CAN READ, AND WHAT THEY CANNOT. `audio-init.js` explains it
// in full; the short of it is that an engineless build writes its whole audio
// layer, so there is no cue bus to subscribe to and no cue NAME to read. What is
// wrapped is the two doors a browser can emit sound through — a Web Audio source
// node being `start()`ed and an `<audio>` element being `play()`ed — and what is
// counted is how many went through them. So every point here asserts THAT a sound
// was emitted and WHEN, never which cue it was; a build that plays its launch
// roar on every drill hit is caught by the reviewer's ear rather than here, and
// that is the honest limit under this engine.
//
// TWO WAYS OF COUNTING, because the game emits sound in two kinds of moment.
// {@link watchCues} in the harness brackets each DRIVEN FRAME and says which
// frame a sound belonged to, which is what a point about an event in the
// simulation wants. A control like `buyUpgrade`, `fabricate` or `useItem` runs
// between frames, though, and a sound it emits falls outside every bracket — so
// {@link countSounds} reads the page's own running total either side of whatever
// it is handed, and catches both.
//
// AUDIO HAS TO BE ARMED FIRST, AND THEN WAITED FOR. A browser will not open an
// audio context without a genuine user gesture, so `armAudio` presses a key
// Chromium itself delivers, bound to nothing so it disturbs no game state. A
// full-stack build then has to DECODE the `.wav` files it produced before it can
// play any of them, which is work a page does asynchronously and off the game's
// clock — so arming waits for the first sound to come out rather than assuming
// the build is ready. That first sound is the music bed `specs/assets.md` runs
// under the whole game. The wait is on the probe itself, a paint at a time, and
// the count of paints is its only cap: nothing here reads a clock.
//
// ARM BEFORE POSING THE SCENE. Waiting drives frames and lets the page paint, and
// a scene opened afterwards resets the clock and the world, so nothing a check
// measures includes the arming.

import { nextPaint, type Harness } from "../harness";

/**
 * How many paints a build is given to open its audio and decode what it produced.
 *
 * A failure cap rather than a measurement: a build that has not made a sound by
 * the last of them has not armed, and every check that reads audio fails on that.
 */
export const AUDIO_READY_PAINTS = 400;

/**
 * How many sounds the build has emitted since the page loaded.
 *
 * The shared harness's own reading over the injected probe, named here so the
 * checks next door go on saying what they mean.
 */
export function soundsStarted(h: Harness): Promise<number> {
  return h.sounds();
}

/**
 * Give the build a real gesture and wait until it is actually making sound.
 *
 * Answers whether it ever did. A check calls this before it poses its scene, and
 * a build that never sounds at all fails on its own point rather than here.
 */
export async function armAudio(h: Harness): Promise<boolean> {
  await h.armAudio();
  for (let paint = 0; paint < AUDIO_READY_PAINTS; paint += 1) {
    if ((await soundsStarted(h)) > 0) return true;
    // A frame of no length, then a paint: the page gets a render and a turn of
    // its own event loop to get on with decoding, and nothing on the game's
    // clock moves.
    await h.advanceSeconds(0, 1);
    await nextPaint(h);
  }
  return false;
}

/** How many sounds the build emitted while `run` ran, frames or not. */
export async function countSounds(
  h: Harness,
  run: () => Promise<unknown>,
): Promise<number> {
  const before = await soundsStarted(h);
  await run();
  return (await soundsStarted(h)) - before;
}

/** How many sounds the build emitted over `seconds` of game time in `frames`. */
export function soundsOver(
  h: Harness,
  seconds: number,
  frames: number,
): Promise<number> {
  return countSounds(h, () => h.advanceSeconds(seconds, frames));
}
