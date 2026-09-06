// board/scatter — opening a run, for the four starting-scatter points.
//
// Private to the board category, because the four points that read the starting
// field are the only ones in this suite whose scenario IS a run opening: every
// other check poses the board it wants through the debug surface.
//
// The starting scatter belongs to the RUN, not to the board: specs/nodes.md lays
// it "when a run starts", and specs/progression.md lists it among what "A new run
// opens on the `playing` screen with", beside three lives, level 1 and the
// `banner` phase. The debug surface deliberately carries no operation that starts
// one — specs/instrumentation.md's operations each set one field, and `setLevel`
// "spawns nothing and clears nothing" — so a run is opened the way a player opens
// one: `reset` puts the game on the title screen with the highlight on the first
// item, and `confirm` takes `DESCEND`, which specs/ui.md states "Opens a new run,
// as specs/progression.md states".
//
// Each run opened is a fresh draw of the scatter, so the four points below read
// several runs for the same requirement, and each names the run that missed.
//
// The reading is taken on the frame the run opens on, while the phase is still
// `banner`. That is the moment the requirement is about, and it is also the only
// moment the field is untouched: the level's worm enters as the banner gives way
// to `active` (specs/progression.md), and a worm bumping a node changes the very
// charge `scatter-inert` reads.

import { COLS, SCATTER_BOTTOM_ROW, SCATTER_TOP_ROW } from "../constants";
import { type Harness, type WirewormSnapshot } from "../harness";

/**
 * The tiles the scatter rows hold: `COLS` (`40`) across the rows
 * `SCATTER_TOP_ROW` (`1`) to `SCATTER_BOTTOM_ROW` (`17`) inclusive, which
 * specs/nodes.md states as `680`.
 */
export const SCATTER_TILES = COLS * (SCATTER_BOTTOM_ROW - SCATTER_TOP_ROW + 1);

/**
 * The runs the scatter is read over, three of them.
 *
 * More than one, because specs/nodes.md draws the tiles at random: a rule that
 * holds for one draw and not another is a rule the build did not implement, and
 * a single draw cannot tell the two apart.
 */
export const RUNS = [1, 2, 3] as const;

/**
 * Open a fresh run the way a player does, and hand back the snapshot of the
 * frame it opened on.
 *
 * `confirm` is bound to `Enter` (specs/controls.md), and `tap` runs the one frame
 * that delivers the key's edge, so the returned snapshot is the run's first.
 */
export async function openRun(h: Harness): Promise<WirewormSnapshot> {
  h.debug.reset();
  await h.tap("Enter");
  return h.snapshot();
}

/** Every tile the snapshot's field occupies, as `"c,r"`. */
export function occupied(snapshot: WirewormSnapshot): Set<string> {
  return new Set(snapshot.nodes.map((node) => `${node.c},${node.r}`));
}
