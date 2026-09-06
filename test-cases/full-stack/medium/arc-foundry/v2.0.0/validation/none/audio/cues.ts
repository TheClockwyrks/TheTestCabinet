// Arc Foundry — hearing the build, for the points about the produced audio.
// CASE-PROVIDED.
//
// WHAT CAN BE HEARD FROM OUTSIDE AN ENGINELESS BUILD, AND WHAT CANNOT. Under an
// engine the cue bus is the engine's: the game asks for a cue BY NAME and the bus
// announces the play. There is no bus here — `specs/ui.md` hands the whole audio
// layer to the build — so the shared harness's audio probe is injected before any
// of the build's script runs and watches the two doors a browser can emit sound
// through: a Web Audio source node being `start()`ed, whatever kind it is, and an
// `<audio>` element being played. What is therefore assertable is that a sound was emitted
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
 * Let the build's audio open, and hand back what it has emitted by then.
 *
 * `specs/ui.md` leaves the first-interaction unlock to the runtime layer an
 * engineless build writes, and a browser opens an audio context asynchronously
 * after the gesture that unlocked it — so the music bed `specs/ui.md` loops "under
 * the yard from the first build phase onward" begins some way into the run rather
 * than on its first frame, and how far in depends on the machine rather than on
 * the build. A run-up held silent has to start after that, or the bed's own start
 * lands inside it and is read as the build blipping.
 *
 * THE FRAMES ARE FIXED AND THE WAITING IS NOT. Two rounds, each of exactly
 * {@link ROUND_FRAMES} frames of the build phase followed by a wait on the state
 * the build reaches — a bounded number of asks for the count the harness's probe
 * keeps, each its own crossing into the page and none of them moving the
 * simulation on. So the build gets an update to ask for its bed, then the page
 * gets its turns to open the context and decode the files, then the build gets
 * further updates in case it only asks once the context is open. The same
 * `ROUNDS * ROUND_FRAMES` frames land whatever the machine did, and only the
 * number of asks — which nothing reads and which cost no simulation — differs.
 *
 * Nothing here reads a clock or pauses for a real duration. The asks are capped
 * so a build that opens no audio at all fails the points that listen for a cue
 * rather than hanging here, and the frames are spent in the opening build phase,
 * which `specs/campaign.md` leaves untimed.
 */
export async function firstSound(h: Harness, from = 0): Promise<number> {
  let heard = await sounds(h);
  for (let round = 0; round < ROUNDS; round += 1) {
    await h.advance(ROUND_FRAMES);
    for (let ask = 0; ask < ASKS && heard <= from; ask += 1) {
      heard = await sounds(h);
    }
  }
  return heard;
}

/** Rounds of frames-then-wait, and the frames each of them drives. */
const ROUNDS = 2;
const ROUND_FRAMES = ticks(0.25);

/**
 * How many times a round asks the page whether the build has emitted anything.
 *
 * Generous, because opening a browser's audio means fetching and decoding every
 * produced cue file — a couple of megabytes for a build that also produced a music
 * bed — and this project drives several pages at once, so how many crossings that
 * takes is a fact about the machine rather than about the build. An ask is a
 * failure cap and never a measurement: nothing reads how many were spent, and the
 * whole budget is paid only by a build that has not opened its audio at all.
 */
const ASKS = 1000;

/**
 * How many sounds the build has emitted since the page loaded.
 *
 * The shared harness's own probe, injected before a line of the build ran, is
 * what counts them; this names it for the suites next door, which read it as the
 * GROWTH across a control they are about rather than as a total.
 */
export async function sounds(h: Harness): Promise<number> {
  return h.sounds();
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
