// Spectra — watching the sounds a build emits frame by frame, for the `audio/*`
// points. CASE-PROVIDED.
//
// `specs/ui.md` fixes nine cues, one per event, and one sentence governs all nine
// of them: "Each is played on the frame its event happens and at most once on
// that frame". So every cue check in this directory is the same measurement in a
// different scenario — pose the one event, step ONE FRAME AT A TIME so a sound
// can be attributed to the frame that produced it, and read what sounded on the
// event's own frame against what sounded on the frames before it.
//
// ONE FRAME AT A TIME IS THE WHOLE POINT. A batched `advance` reaches the same
// state and says nothing about WHEN inside it a sound was made, and a check that
// read only "a sound happened somewhere in this window" would pass a build that
// blips continuously as readily as one that blips on the shot.
//
// WHAT THIS ENGINE CAN AND CANNOT SEE. Under an engine the cue bus is the
// engine's: the game asks for a cue BY NAME and the bus announces the play, so a
// check reads the name. An engineless build writes the whole audio layer itself,
// synthesizing with the Web Audio API, so there is no bus to subscribe to and no
// name to read — `specs/ui.md` fixes the nine names inside the build's own code
// and says nothing about how a build makes a sound. What is observable is that a
// sound was emitted and on which driven frame, which `validation/audio-init.js`
// obtains by watching the two doors a browser can emit sound through. Two
// consequences follow, and both are honest reductions rather than choices:
//
//   * A cue is counted as SOUNDS, not as one play. A blip made of a tone and a
//     noise burst is two sources and one cue, and the specification never fixed
//     the number, so these checks ask that the event's frame SOUNDED — not that
//     it sounded once. "At most once on that frame" is not decidable here.
//   * The quiet before the event is read as total silence rather than as the
//     absence of one named cue. Every scenario in this directory poses exactly
//     one event and holds everything else still, so on a conforming build there
//     is nothing else for that window to carry.
//
// NO CHECK IN THIS DIRECTORY MAY ASSERT A CUE NAME.
//
// ONLY `advance` ATTRIBUTES A SOUND TO A FRAME (see `watchCues` in `harness.ts`):
// a sound emitted inside a `skip` lands on the frame the skip ended on. So every
// watch here advances, and a scenario that has to sit through a stage's entrance
// skips BEFORE the watch opens rather than inside it.

import { fail } from "../assert";
import { SHIP_Y, type Band } from "../constants";
import {
  lastBullet,
  watchCues,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** What one driven frame sounded. */
export interface FrameCues {
  /** Which frame of this watch it was, from `1`. */
  step: number;
  /** How many sounds the build emitted on it. */
  sounds: number;
}

/** What a watch saw. */
export interface CueWatch {
  /** The event was reached inside the budget. */
  hit: boolean;
  /** The frame of the watch the event was first seen on, or `-1`. */
  at: number;
  /** One record per frame driven, in order. */
  frames: FrameCues[];
  /** The state the watch ended on. */
  snapshot: SpectraSnapshot;
}

/** How a watch is staged around the event it is about. */
export interface WatchOptions {
  /**
   * Frames driven before {@link WatchOptions.arm} is called.
   *
   * For an event that lands on the first frame it possibly can — a key read once
   * per press, a flip that is instant — the frames before it would otherwise be
   * none at all, and "nothing sounded before the event" would be a reading of an
   * empty window. A lead gives that reading something to be quiet across, driven
   * on exactly the field the event is then staged on.
   */
  quietLead?: number;
  /** The gesture that stages the event, run after the quiet lead. */
  arm?: () => void | Promise<void>;
}

/**
 * Step one frame at a time until `event` holds, keeping what sounded on each.
 *
 * The budget is a HARD window rather than an open-ended wait, so a build whose
 * event never arrives fails on the bound the check states rather than running
 * until the suite times out.
 *
 * The event is read from the snapshot taken AFTER each frame, so the frame a
 * check calls the event's is the frame during which the build's own code produced
 * it — which is the frame `specs/ui.md` requires the cue on.
 */
export async function watchForEvent(
  h: Harness,
  event: (snapshot: SpectraSnapshot) => boolean,
  maxFrames: number,
  options: WatchOptions = {},
): Promise<CueWatch> {
  const { quietLead = 0, arm } = options;
  const sink = watchCues(h);
  const frames: FrameCues[] = [];
  let read = 0;
  let armed = arm === undefined;

  for (let step = 1; step <= maxFrames; step += 1) {
    if (!armed && step > quietLead) {
      await arm?.();
      armed = true;
    }
    await h.advance(1);
    const frame = h.frame();
    const sounds = sink.slice(read).filter((cue) => cue.frame === frame).length;
    read = sink.length;
    frames.push({ step, sounds });

    const snapshot = await h.snapshot();
    if (armed && event(snapshot)) {
      return { hit: true, at: step, frames, snapshot };
    }
  }
  return { hit: false, at: -1, frames, snapshot: await h.snapshot() };
}

/** How many sounds the build emitted on the event's own frame. */
export function soundsOnEvent(watch: CueWatch): number {
  return watch.frames.find((one) => one.step === watch.at)?.sounds ?? 0;
}

/** How many sounds it emitted on any frame before the event's. */
export function soundsBeforeEvent(watch: CueWatch): number {
  return watch.frames
    .filter((one) => watch.at < 0 || one.step < watch.at)
    .reduce((total, one) => total + one.sounds, 0);
}

/** How many frames of quiet the watch actually read before the event. */
export function quietFrames(watch: CueWatch): number {
  return watch.at < 0 ? watch.frames.length : watch.at - 1;
}

/**
 * Put one enemy bullet `above` units over the ship's centre and hand back its id.
 *
 * The arrangement half of `harness.ts`'s `fireAtShip`, without its drive: a cue
 * check has to step the fall one frame at a time to know which frame the contact
 * landed on, and `fireAtShip` sweeps it in batches. Nothing about the outcome is
 * posed — the build's own contact and band rules decide what the bullet does.
 */
export async function poseEnemyBulletAbove(
  h: Harness,
  band: Band,
  above: number,
): Promise<number> {
  const before = await h.snapshot();
  await h.debug.addEnemyBullet(before.ship.x, SHIP_Y - above, band);
  const added = lastBullet(await h.snapshot());
  if (added === undefined) {
    fail(
      "addEnemyBullet to append a bullet to the roster (specs/instrumentation.md)",
      "the bullet roster was still empty after addEnemyBullet",
    );
  }
  return added.id;
}

/**
 * Put one of the player's bullets `below` units under `(x, y)` and hand back its
 * id.
 *
 * The arrangement half of `harness.ts`'s `fireAt`, without its drive, for the
 * same reason {@link poseEnemyBulletAbove} exists.
 */
export async function poseShotBelow(
  h: Harness,
  x: number,
  y: number,
  band: Band,
  below: number,
): Promise<number> {
  await h.debug.addPlayerBullet(x, y + below, band);
  const added = lastBullet(await h.snapshot());
  if (added === undefined) {
    fail(
      "addPlayerBullet to append a bullet to the roster (specs/instrumentation.md)",
      "the bullet roster was still empty after addPlayerBullet",
    );
  }
  return added.id;
}
