// machinery/bore — the one drive a bore is reached through.
//
// A BORE IS NOT POSED, IT IS EARNED. `specs/instrumentation.md`
// (`grantMachinery`) grants the three TIMED kinds and says of the fourth: "`bore`
// is not granted here. It removes cores and scores the moment it resolves, and no
// pose decides an outcome, so a caller that wants a bore poses a run carrying a
// `bore` mark and lets the ticks extract it." That is what this file does, and
// both bore points share it.
//
// HOW THE EXTRACTION IS DRIVEN. By a merge rather than by a shot, so nothing in
// the injector enters the reading. `specs/channel.md` ("Advance") rides every
// non-lead segment at 180 units/s against a lead segment on the level's 22, so
// the one segment that can close on another is the one directly behind the lead
// one. A single core of the run's charge is posed a gap further back than the
// channel spacing; its advance carries it to the merge position, "the head is
// clamped to exactly that position" and the two become one — and
// `specs/extraction.md` ("Extraction on a merge") extracts the same-charge run
// spanning the join, three cores long here.
//
// WHY THE TRAIN TURNS THE CORNER. The cores of one segment stand a channel
// spacing apart, so on a straight leg only multiples of 28 are available and the
// nearest pair straddling `BORE_RADIUS` would be 84 and 112. Laid across the
// vertex at `(920, 40)` — `specs/channel.md`'s vertex table, arc 880 — the same
// spacing gives straight-line distances that straddle the radius by about eleven
// units either side. The reading is a straight line across the field, exactly as
// `specs/machinery.md` measures it, and not an arc distance.
//
// WHY EVERY CORE IT MEASURES IS AHEAD OF THE REMOVAL. `specs/extraction.md`
// ("Removals and recoil"): "Every remaining core ahead of the frontmost core the
// removal took keeps its arc position." Every core these points read is ahead of
// the extracted run, so neither the extraction's recoil nor the bore's own moves
// any of them, and each stands exactly where it was posed plus the arc the lead
// segment rode while the drive ran. That common advance is read back off the
// surviving head — which is far outside the radius — rather than assumed, which
// is what makes the extraction point a measurement of the state on the tick it
// resolved rather than a prediction.

import { assertTrue } from "../assert";
import {
  SPACING,
  type ChargeId,
  type MachineryKind,
  type TimedMachineryKind,
} from "../constants";
import {
  coreCount,
  poseHall,
  type Harness,
  type PosedCore,
  type UntilResult,
} from "../harness";

/** The level the hall opens on; the bore's radius is the same on every level. */
export const LEVEL = 1;

/** The charge the extracted run is made of. */
export const RUN_CHARGE: ChargeId = "halide";

/** The arc position of the marked core: the tail of the lead segment. */
export const MARKED_S = 824;

/**
 * The lead segment, head first and one channel spacing apart, laid across the
 * vertex at arc 880 so the straight-line distances are not multiples of 28.
 *
 * The two behind carry the run's charge; the rest alternate two others, so the
 * maximal same-charge run spanning the join is exactly three long.
 */
export const LEAD: PosedCore[] = [
  [MARKED_S + SPACING * 7, "sulfur", null], // 1020 — furthest out
  [MARKED_S + SPACING * 6, "cobalt", null], // 992
  [MARKED_S + SPACING * 5, "sulfur", null], // 964 — outside the radius
  [MARKED_S + SPACING * 4, "cobalt", null], // 936 — inside the radius
  [MARKED_S + SPACING * 3, "sulfur", null], // 908
  [MARKED_S + SPACING * 2, "cobalt", null], // 880 — the vertex
  [MARKED_S + SPACING, RUN_CHARGE, null], // 852 — in the extracted run
  [MARKED_S, RUN_CHARGE, "bore"], // 824 — the marked core
];

/** The head of the lead segment, whose advance the drive reads back. */
export const HEAD_S = LEAD[0][0];

/** How far behind the merge position the closing core starts. */
const CLOSING_GAP = 30;

/** The core that closes the gap and completes the run. */
const CLOSER_S = MARKED_S - SPACING - CLOSING_GAP;

/** Where the closing core stands once the merge has clamped it. */
export const CLOSER_MERGED_S = MARKED_S - SPACING;

/** Every core the pose puts on the channel. */
export const CORES: PosedCore[] = [...LEAD, [CLOSER_S, RUN_CHARGE, null]];

/**
 * How long the drive waits for the merge, in ticks.
 *
 * `specs/channel.md` fixes the closing rate at 180 units/s against a lead segment
 * riding at most the level's 22, so {@link CLOSING_GAP} closes in under 12 ticks.
 * The cap is five times that, and every distance the points read is computed
 * from the arc actually ridden rather than from an assumed one.
 */
const MERGE_MAX_TICKS = 60;

/** Ticks recorded after the bore resolves, so a replay shows what it left. */
export const TRAILING_TICKS = 40;

/**
 * The lead-segment core the bore removes, chosen for {@link poseBoreHall}'s
 * `neighbourMark`.
 *
 * Index 3 of {@link LEAD}, at arc 936: the nearest core INSIDE the radius, about
 * eleven units clear of the 90-unit bound (`machinery/bore-radius` asserts that
 * margin rather than assuming it), and not part of the run the merge extracts.
 */
const NEIGHBOUR_INDEX = 3;

/** What {@link poseBoreHall} arranges beyond the pose every bore point shares. */
export interface BoreOptions {
  /** A timed machinery already running when the bore resolves. */
  standing?: TimedMachineryKind;
  /** A mark to put on the core the bore removes, at arc 936. */
  neighbourMark?: MachineryKind;
}

/**
 * Pose the hall the bore is earned in.
 *
 * Nothing here decides an outcome: the merge, the extraction, the grant and the
 * bore all come from the ticks {@link driveBore} steps afterwards.
 */
export async function poseBoreHall(
  h: Harness,
  options: BoreOptions = {},
): Promise<void> {
  const cores: PosedCore[] = CORES.map((core, index) =>
    index === NEIGHBOUR_INDEX && options.neighbourMark !== undefined
      ? [core[0], core[1], options.neighbourMark]
      : core,
  );
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores,
    // Granted before the first tick, so what the bore does to it is readable on
    // the tick the bore resolves.
    machinery: options.standing,
  });
}

/** The arc position of the core {@link BoreOptions.neighbourMark} marks. */
export const NEIGHBOUR_S = LEAD[NEIGHBOUR_INDEX][0];

/** Step until the run carrying the mark leaves the channel. */
export async function driveBore(h: Harness): Promise<UntilResult> {
  const swept = await h.stepUntil((s) => coreCount(s) < CORES.length, {
    maxTicks: MERGE_MAX_TICKS,
    poll: 1,
  });
  assertTrue(
    swept.hit,
    `the run holding the bore mark was extracted within ${MERGE_MAX_TICKS} ticks`,
  );
  return swept;
}
