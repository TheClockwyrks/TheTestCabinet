// Arc Foundry — hearing the build, for the points about the produced audio.
// CASE-PROVIDED.
//
// WHAT CAN BE HEARD FROM OUTSIDE AN ENGINELESS BUILD, AND WHAT CANNOT. Under an
// engine the cue bus is the engine's: the game asks for a cue BY NAME and the bus
// announces the play. There is no bus here — `specs/ui.md` hands the whole audio
// layer to the build — so `audio-init.js` is injected before any of the build's
// script runs and watches the two doors a browser can emit sound through: a Web
// Audio source node being `start()`ed, whatever kind it is, and an `<audio>`
// element being played. What is therefore assertable is that a sound was emitted
// and WHEN. The cue's NAME is not observable, so no check here asserts it; that
// half is the reviewer's, by ear, and `audio/cue-files-distinct` is what makes it
// possible for them to tell the eleven apart.
//
// TWO CLOCKS, BECAUSE TWO KINDS OF EVENT. `specs/ui.md` plays each cue "on the
// update its event happens".
//
//   An event the SIMULATION raises — a shot, a hit, a kill, a leak — happens inside
//   a driven frame, and `watchCues` from the harness stamps each sound with the
//   frame it was emitted on. Those points read the frame.
//
//   An event a CONTROL raises — a rock landing, a fold resolving, the level's
//   candidates hardening — resolves at the call that commits it, which is not
//   inside a frame at all. A build may sound it there or on the update that
//   follows, and both are "the update its event happens"; the specification fixes
//   nothing finer. So those points count the sounds emitted across the call AND the
//   frame after it, with `sounds`, and hold the frames leading up to the control
//   silent.

import type { ComponentType, Tier } from "../constants";
import { structureCenter } from "../constants";
import {
  captureReplay,
  emptyYard,
  parkUnit,
  standComponent,
  ticks,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
export const ANCHOR = { col: 21, row: 17 };
export const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/**
 * Eighty units from the head: inside the Scrap range of every firing base type,
 * the shortest of which is the Emitter's `88` (`specs/components.md`).
 */
export const TARGET = { x: HEAD.x + 80, y: HEAD.y };

/** The run-up held silent before an event, in frames. */
export const RUN_UP = ticks(0.1);

/**
 * Frames of run driven before anything is listened for.
 *
 * `specs/ui.md` leaves the first-interaction unlock to the runtime layer an
 * engineless build writes, and a browser opens an audio context asynchronously
 * after the gesture that unlocked it — so the music bed `specs/ui.md` loops "under
 * the yard from the first build phase onward" may begin a fraction of a second
 * into the run rather than on its first frame. Both are the same requirement met;
 * driving half a second of run first puts that start behind every reading rather
 * than inside one.
 */
export const SETTLE = ticks(0.5);

/** How many sounds the build has emitted since the page loaded. */
export async function sounds(h: Harness): Promise<number> {
  return h.page.evaluate(() =>
    (
      window as unknown as { __foundryAudio: { started(): number } }
    ).__foundryAudio.started(),
  );
}

/** The cues that sounded on one frame of the drive. */
export function onFrame(cues: readonly TimedCue[], frame: number): TimedCue[] {
  return cues.filter((cue) => cue.frame === frame);
}

/** The cues that sounded before one frame of the drive. */
export function beforeFrame(
  cues: readonly TimedCue[],
  frame: number,
): TimedCue[] {
  return cues.filter((cue) => cue.frame < frame);
}

/** What one firing structure's first shot sounded like. */
export interface Shot {
  /** Whether it fired at all inside the window. */
  fired: boolean;
  /** The frame of the drive its projectile appeared on. */
  frame: number;
  /** Every sound emitted from the moment it was left alone with no target. */
  cues: TimedCue[];
}

/**
 * Stand one firing structure on an emptied yard, hold it silent with nothing in
 * range, then give it a target and run to its first shot.
 *
 * The silent run-up is the half of the requirement that says "and on no frame
 * before it": a structure with nothing in range holds fire (`specs/components.md`),
 * so a build that blips every frame is caught before the shot is ever taken.
 */
export async function fireOnce(
  h: Harness,
  type: ComponentType,
  tier: Tier,
): Promise<Shot> {
  await emptyYard(h);
  await standComponent(h, type, tier, ANCHOR.col, ANCHOR.row);
  await h.advance(1);

  const cues = watchCues(h);
  await h.advance(RUN_UP);
  await parkUnit(h, "slug", TARGET);
  const fired = await h.until((s) => s.projectiles.length > 0, {
    maxFrames: ticks(4),
  });
  return { fired: fired.hit, frame: h.frame(), cues };
}

/**
 * Record a point's declared replay, and never let recording it decide the point.
 *
 * The two points that read the produced files off disk declare a replay of a run
 * as their evidence, and a build whose surface cannot be driven must still pass
 * or fail on the files alone. So the drive below is evidence and nothing more.
 */
export async function evidence(
  h: Harness,
  outputId: string,
  drive: () => Promise<void>,
): Promise<void> {
  await captureReplay(h, outputId, async () => {
    try {
      await drive();
    } catch (error) {
      console.warn(
        `arc foundry: could not drive the replay for \`${outputId}\`: ` +
          String(error),
      );
    }
  });
}
