// audio/cues — what the points of this category share: opening a night with the
// build's audio awake, waiting for a loop the specification asks for, and
// reading one cue off one frame. CASE-PROVIDED.
//
// No review item names this file. Each function is a compound sequence of the
// surface's atomic operations or a reading over the named-cue log, which the
// authoring guide has live beside the checks rather than inside any one of them.
//
// WHY A NIGHT IS OPENED THE WAY IT IS. A browser opens no audio context without
// a genuine user gesture, so `armAudio` presses `UNBOUND_KEY`, a key
// specs/controls.md binds to nothing, through Chromium's own input pipeline, and
// then waits for the build's fifteen produced files to decode. Only after that
// is the world posed: specs/instrumentation.md has "a pose changes the state
// alone and sounds nothing; the cues a scenario hears come from the ticks and
// frames run after it", and the two loops are "reconciled from the state by the
// next frame". So every check here arranges by poses, steps, and reads.
//
// WHY THE SETTLING FRAMES. specs/ui.md loops `music` "on every frame exactly
// when `screen` is `playing`, `levelup`, `chest`, or `paused`", so the frames
// that follow `isolate`'s `setScreen("playing")` are where a conformant build
// starts its bed. Running them BEFORE a check attaches its watcher keeps the
// bed's own start out of the frame a check reads, and leaves the point's frame
// carrying its own event's cues alone.

import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { TICK_HZ, type ScreenName } from "../constants";
import {
  cuesNamed,
  cuesOnFrame,
  isLooping,
  isolate,
  loopSourcesOf,
  placeEnemyNear,
  type EnemyView,
  type Harness,
  type IsolateOptions,
  type NamedCue,
  type WickSnapshot,
} from "../harness";

/**
 * Frames run after a night is posed, before a check watches anything.
 *
 * Two: one for the loops to be reconciled from the posed state, and one more so
 * a build that reconciles at the end of its frame rather than at the start has
 * had a whole frame of `playing` either way. specs/instrumentation.md fixes the
 * bound the first of them rests on ("The two looping cues are reconciled from
 * the state by the next frame"); the second is slack, and decides nothing.
 */
export const SETTLE_FRAMES = 2;

/**
 * How long {@link stepUntilLoop} waits for a loop the specification asks for.
 *
 * One second of frames. The specification has a loop up by the frame after the
 * state that calls for it, so a conformant build is read on the first poll and
 * spends nothing; the budget is here because a build loads and decodes its own
 * produced `.wav` (specs/assets.md), and how long that takes is a fact about the
 * host rather than about the build. It is a drive length, never a threshold: a
 * build with no loop spends the second and then fails on its own terms.
 */
export const LOOP_WAIT_FRAMES = TICK_HZ;

/**
 * Wake the build's audio, pose an isolated night, and let the loops settle.
 *
 * `isolate` is the harness's own arrangement: a fresh run on `playing` with
 * every driver switch off, nothing alive, nothing dropped, no slot held, and the
 * level lifted out of reach of any gain. What this adds is the browser gesture
 * that lets a build's audio open at all, and the settling frames above.
 */
export async function openNight(
  h: Harness,
  options: IsolateOptions = {},
): Promise<WickSnapshot> {
  await h.armAudio();
  await isolate(h, options);
  await h.step(SETTLE_FRAMES);
  return h.snapshot();
}

/**
 * Step one frame at a time until `name` is looping, and answer whether it is.
 *
 * Never throws and never asserts: the caller that needs the loop up as a
 * precondition asserts on what comes back, so a build with no loop fails with
 * its own message rather than inside a helper.
 */
export async function stepUntilLoop(
  h: Harness,
  name: string,
  maxFrames = LOOP_WAIT_FRAMES,
): Promise<boolean> {
  for (let i = 0; i < maxFrames; i += 1) {
    if (await isLooping(h, name)) return true;
    await h.step(1);
  }
  return isLooping(h, name);
}

/** How many times the cue `name` sounded on `frame`. */
export function heard(
  cues: readonly NamedCue[],
  frame: number,
  name: string,
): number {
  return cuesNamed(cuesOnFrame(cues, frame), name).length;
}

/** The cue `name` sounded on `frame` at least once. */
export function assertHeard(
  cues: readonly NamedCue[],
  frame: number,
  name: string,
  context: string,
): void {
  assertGreaterThanOrEqual(heard(cues, frame, name), 1, context);
}

/**
 * The cue `name` sounded on `frame` exactly once.
 *
 * specs/ui.md: a cue is played "at most once on that tick: a tick on which
 * twenty enemies take damage plays `hit` once".
 */
export function assertHeardOnce(
  cues: readonly NamedCue[],
  frame: number,
  name: string,
  context: string,
): void {
  assertEqual(heard(cues, frame, name), 1, context);
}

/** The cue `name` did not sound on `frame`. */
export function assertSilent(
  cues: readonly NamedCue[],
  frame: number,
  name: string,
  context: string,
): void {
  assertEqual(heard(cues, frame, name), 0, context);
}

/**
 * Spawn `count` moths evenly around a circle of `radius` about the lamplighter,
 * and answer them in spawn order.
 *
 * What the two "once per tick" points of the burst share. The radius is the
 * caller's, and every check that uses this states why its own is what it is.
 */
export async function ringOfMoths(
  h: Harness,
  count: number,
  radius: number,
): Promise<EnemyView[]> {
  const moths: EnemyView[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i * 2 * Math.PI) / count;
    moths.push(
      await placeEnemyNear(
        h,
        "moth",
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      ),
    );
  }
  return moths;
}

/** What one frame of a stretch reported about a loop. */
export interface LoopFrame {
  /** The frame, 1-based as {@link Harness.frame} counts. */
  frame: number;
  /** The screen that frame ran on. */
  screen: ScreenName;
  /** How many sources of the cue were sounding as loops after that frame. */
  sources: number;
}

/**
 * Step `frames` frames one at a time, reading the screen and the sources of
 * `name` still looping after each.
 *
 * One frame per crossing rather than one batched drive, because the reading is
 * of every frame: specs/ui.md fixes a loop "on every frame" of the screens it
 * names, and `h.step(n)` runs its whole count inside one evaluation, which would
 * leave the frames between the ends unread.
 */
export async function loopOverFrames(
  h: Harness,
  name: string,
  frames: number,
): Promise<LoopFrame[]> {
  const read: LoopFrame[] = [];
  for (let i = 0; i < frames; i += 1) {
    const snapshot = await h.step(1);
    read.push({
      frame: h.frame(),
      screen: snapshot.screen,
      sources: await loopSourcesOf(h, name),
    });
  }
  return read;
}
