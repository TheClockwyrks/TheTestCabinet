// Deepcore — the scene the Core Sample checks share.
//
// Not a suite: a `.ts` beside the suites, which the project never collects. It
// arranges what several checks arrange identically and decides nothing.
//
// TWO PLACES A CORE RUN HAPPENS. The Core chamber, where a Sample is taken, and
// the camp, where its timer is watched, jettisoned, saved against or spent. Both
// open from `openScene`, which leaves an empty mine and the miner at the camp, so
// each of these puts back exactly what its checks are about and nothing else.
//
// THE FACULTIES. Every check here is about the Sample rather than about the
// miner's body, so travel is held off wherever the miner has to stay where it was
// posed: an empty mine is open under the camp, a Core detonation would throw the
// miner about, and a jettison drops the Sample on the cell the miner is standing
// in. The drill is held off everywhere except the two checks that drill the Core,
// which is the only thing in the game that takes a Sample out of it.
//
// THE CLOCK IS COARSE ON PURPOSE. `specs/instrumentation.md` fixes that every
// rate is integrated against the frame's delta, so an interval of game time
// reaches the same state however it was divided; a ninety-second timer read in
// tenth-second frames is the same timer, and reading it in eight-millisecond ones
// would render ten thousand frames to answer the same question.

import {
  ACTION_KEY,
  cellCenter,
  layFloor,
  minerCenter,
  openScene,
  pinDrill,
  pinMiner,
  standAtCamp,
  standOn,
  type DeepcoreSnapshot,
  type Harness,
} from "../harness";
import { CORE_COL, TILE } from "../constants";

/**
 * How long one frame of a driven span covers, in seconds of game time.
 *
 * Twenty-five a second: fine enough that a span recorded as a review item's
 * replay plays back as motion rather than as a slideshow, and coarse enough that
 * a ninety-second timer is a few hundred rendered frames rather than ten
 * thousand. Nothing here depends on the division — `specs/instrumentation.md`
 * fixes that an interval of game time reaches the same state however it was cut
 * into frames.
 */
const FRAME_SECONDS = 0.04;

/** Run `seconds` of game time in whole frames of about {@link FRAME_SECONDS}. */
export function elapse(h: Harness, seconds: number): Promise<void> {
  return h.advanceSeconds(
    seconds,
    Math.max(2, Math.ceil(seconds / FRAME_SECONDS)),
  );
}

/** The scene a check about the timer, the jettison or the pad opens: the camp. */
export async function openCampScene(h: Harness): Promise<void> {
  await openScene(h);
  await layFloor(h, 1);
  await standAtCamp(h);
  await pinMiner(h);
  await pinDrill(h);
}

/**
 * Stand the miner on the Core, with its body held still and its drill running.
 *
 * The Core sits at `(CORE_COL, coreRow)` and `clearMine` leaves the chamber
 * alone, so the cell is already there in a scene opened from `openScene`; the
 * miner stands ON it, which is the cell a held `down` cuts into.
 */
export async function standOnCore(h: Harness): Promise<DeepcoreSnapshot> {
  const before = await h.snapshot();
  await standOn(h, CORE_COL, before.coreRow);
  await pinMiner(h);
  return h.snapshot();
}

/** The longest a Core extraction is given before it is called stuck, in seconds. */
const EXTRACT_MAX_SECONDS = 8;

/** How long each step of the extraction sweep covers. */
const EXTRACT_STEP = 0.2;

/** What a driven extraction did. */
export interface ExtractResult {
  /** Whether a Sample reached the satchel inside the sweep. */
  taken: boolean;
  /** Game time held before the sample that saw it, in seconds. */
  elapsed: number;
  snapshot: DeepcoreSnapshot;
}

/**
 * Hold `down` on the Core until a Sample reaches the satchel.
 *
 * The real drill: the key goes down through the surface's own input and the
 * game's own update lands the hits, so what extracts the Sample is the game's
 * rule rather than a pose. The sweep samples every {@link EXTRACT_STEP} of game
 * time, which bounds how far the destabilization timer can have run by the time
 * the extraction is seen.
 */
export async function extractSample(h: Harness): Promise<ExtractResult> {
  await h.hold(ACTION_KEY.down);
  try {
    let elapsed = 0;
    let snapshot = await h.snapshot();
    while (!snapshot.satchel.coreSample && elapsed < EXTRACT_MAX_SECONDS) {
      await elapse(h, EXTRACT_STEP);
      elapsed += EXTRACT_STEP;
      snapshot = await h.snapshot();
    }
    return { taken: snapshot.satchel.coreSample, elapsed, snapshot };
  } finally {
    await h.release(ACTION_KEY.down);
  }
}

/** The widest gap the extraction sweep can leave between the take and the read. */
export const EXTRACT_SAMPLE_GAP = EXTRACT_STEP;

/** How long a scene waits for the expedition to end before calling it unended. */
const OVER_MAX_SECONDS = 8;

/** Run the game on until the expedition leaves `in-mine`, or the wait runs out. */
export async function runUntilOver(
  h: Harness,
  maxSeconds: number = OVER_MAX_SECONDS,
): Promise<DeepcoreSnapshot> {
  let elapsed = 0;
  let snapshot = await h.snapshot();
  while (snapshot.screen === "in-mine" && elapsed < maxSeconds) {
    await elapse(h, 0.25);
    elapsed += 0.25;
    snapshot = await h.snapshot();
  }
  return snapshot;
}

/** How far the miner's centre is from a cell's centre, in tiles. */
export function tilesFromCell(
  snapshot: DeepcoreSnapshot,
  col: number,
  row: number,
): number {
  const centre = cellCenter(col, row);
  const miner = minerCenter(snapshot.miner);
  return Math.hypot(miner.x - centre.x, miner.y - centre.y) / TILE;
}
