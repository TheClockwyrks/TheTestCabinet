// den/schedule.ts — what the two den checks share.
//
// Both items read the SAME clock: `specs/predators.md`'s staggered release, whose
// times are `0 s`, `DEN_RELEASE_GAP` and `2 * DEN_RELEASE_GAP` "measured from the
// moment live play begins". So both need the same three things, and they live
// here rather than being written twice:
//
//   * a parking spot for the forager that is clear of the den, because a forager
//     caught mid-measurement re-dens every predator and restarts the very
//     schedule being read;
//   * a watch that dates each predator's release; and
//   * the tolerance the two items state.
//
// THE SCHEDULE IS READ OFF `released`, NEVER OFF `state` OR A TILE.
// `specs/predators.md` is explicit: "`DEN_RELEASE_GAP` is the spacing between
// release times, not between arrivals in the corridor. `released` is the schedule
// itself, and `state` leaving `"den"` is the swim that follows it." The chamber is
// several tiles wide and `specs/maze.md` fixes neither its interior nor which tile
// a hunter waits on, so timing the stagger from the moment a hunter clears the
// gate charges every gap the difference between two swims: a build releasing
// exactly `5 s` apart from tiles one and three would report gaps of four and six.
//
// THESE TWO CHECKS RUN ON THE BUILD'S OWN MAZE, which is the exception to the
// posed-fixture rule in `fixtures.ts`. `setMaze` "suspends" the release schedule
// (`specs/instrumentation.md`), so a posed board is exactly the board on which
// there is no schedule to read.

import { DEN_ORDER, DEN_RELEASE_GAP } from "../../src/constants";
import { parkForager, unmetPrecondition } from "../scene";
import type { Harness } from "../harness";
import type { FathomSnapshot } from "../surface";
import type { Tile } from "../maze";

/**
 * How far a measured release may sit from the time the schedule gives it, in
 * seconds.
 *
 * Both items state it: "within a tenth of a second". The watch below resolves an
 * event to its own poll, which is {@link WATCH_POLL} ticks — a sixtieth of a
 * second — so all but a sixth of this band is room for the build.
 */
export const RELEASE_TOLERANCE = 0.1;

/** How often the den is read, in ticks: a sixtieth of a second. */
export const WATCH_POLL = 2;

/** How long after its due time a release is still waited for, in seconds. */
export const RELEASE_GRACE = 3;

/** One predator's release: which hunter, where on the roster, and when. */
export interface Release {
  kind: string;
  index: number;
  /** The snapshot's `simTime` at the first sample that saw `released` true. */
  t: number;
}

/** What {@link watchReleases} found. */
export interface DenWatch {
  /** The releases seen, in the order they arrived. */
  releases: Release[];
  /** A predator whose `released` is not a boolean, named, or `null`. */
  missingFlag: string | null;
  /** The last state the watch read. */
  last: FathomSnapshot;
}

/** Every tile of the board carrying `character`, in reading order. */
function tilesOf(snap: FathomSnapshot, character: string): Tile[] {
  const found: Tile[] = [];
  for (let ty = 0; ty < snap.grid.rows; ty += 1) {
    const row = snap.tiles[ty] ?? "";
    for (let tx = 0; tx < snap.grid.cols; tx += 1) {
      if (row[tx] === character) found.push({ tx, ty });
    }
  }
  return found;
}

/**
 * Park the forager as far from the den gate as the build's own maze allows, and
 * eat the pellet it is standing on.
 *
 * THE FORAGER IS A BYSTANDER IN BOTH ITEMS, and an expensive one to lose: contact
 * costs a life, and a life lost "returns every predator to the den unreleased"
 * and runs the whole schedule again (`specs/predators.md`), which is the clock
 * being measured. Distance is what buys the measurement its ten seconds — a
 * released hunter has to cross the maze before it is a problem — and the pellet
 * is eaten so the forager sits at `G = 0`, where the Lanternjaw's reach is its
 * narrowest `LANTERN_RANGE_BASE`.
 *
 * The tile is chosen among those with a rock neighbour, so {@link parkForager}
 * has a wall to face the forager into and it cannot drift off the tile it was
 * put on.
 *
 * THE PELLET IS TAKEN OFF RATHER THAN EATEN. `setPlankton(tx, ty, false)`
 * "is not eating it, so it scores nothing and clears no maze"
 * (`specs/instrumentation.md`) and, unlike eating one, it costs no tick — which
 * matters here because both items date the schedule from an instant, and a tick
 * spent tidying the board is a tick the den's own clock may already be running
 * in.
 */
export async function parkClearOfDen(h: Harness): Promise<Tile> {
  const snap = h.snapshot();
  const gates = tilesOf(snap, "g");
  const corridors = tilesOf(snap, ".");
  if (corridors.length === 0) {
    unmetPrecondition(
      "the build's maze reports no corridor tile at all, so there is nowhere " +
        "to stand the forager clear of the den — what the board holds is the " +
        "maze checks' verdict, not this one's",
    );
  }
  const walled = corridors.filter((tile) => {
    const around = [
      snap.tiles[tile.ty - 1]?.[tile.tx],
      snap.tiles[tile.ty + 1]?.[tile.tx],
      snap.tiles[tile.ty]?.[tile.tx - 1],
      snap.tiles[tile.ty]?.[tile.tx + 1],
    ];
    return around.some((neighbour) => neighbour !== ".");
  });
  const candidates = walled.length > 0 ? walled : corridors;
  const score = (tile: Tile): number =>
    gates.length === 0
      ? 0
      : Math.min(
          ...gates.map((gate) =>
            Math.hypot(gate.tx - tile.tx, gate.ty - tile.ty),
          ),
        );
  let best = candidates[0];
  for (const tile of candidates) if (score(tile) > score(best)) best = tile;
  await parkForager(h, best);
  h.debug.setPlankton(best.tx, best.ty, false);
  h.debug.setBrightness(0);
  return best;
}

/**
 * Watch the den for `seconds` of simulated time, dating each predator's release.
 *
 * Stops early once `count` releases are in. `count` is the roster's length rather
 * than a constant, so a build whose depth-`1` roster is not the three
 * `specs/predators.md` gives is reported by the roster's own item instead of
 * stalling this watch.
 *
 * The watch runs on {@link Harness.advance}, so a section captured around it is a
 * recording of the den emptying, which is exactly the evidence both items owe a
 * reviewer.
 */
export async function watchReleases(
  h: Harness,
  options: { seconds: number; count: number },
): Promise<DenWatch> {
  const releases: Release[] = [];
  const seen = new Set<number>();
  let missingFlag: string | null = null;
  let last = h.snapshot();
  const deadline = last.simTime + options.seconds;

  const note = (snap: FathomSnapshot): void => {
    for (const [index, predator] of snap.predators.entries()) {
      if (typeof predator.released !== "boolean") {
        missingFlag ??= `the ${predator.kind} reports \`released\` as ${JSON.stringify(
          predator.released,
        )}`;
        continue;
      }
      if (!seen.has(index) && predator.released) {
        seen.add(index);
        releases.push({ kind: predator.kind, index, t: snap.simTime });
      }
    }
  };

  note(last);
  while (releases.length < options.count && last.simTime < deadline) {
    await h.advance(WATCH_POLL);
    last = h.snapshot();
    note(last);
  }
  return { releases, missingFlag, last };
}

/**
 * Watch the dive countdown for `seconds`, naming any predator released while it
 * runs.
 *
 * `specs/predators.md`: "Release time `0` is the moment the dive countdown ends
 * and `screen` becomes `"playing"`, so the countdown counts against nothing and no
 * predator leaves the den while one is running." Stops the moment the countdown
 * ends, because a release after that is the schedule rather than a breach.
 */
export async function watchCountdown(
  h: Harness,
  seconds: number,
): Promise<{ loose: string[]; last: FathomSnapshot }> {
  const loose: string[] = [];
  let last = h.snapshot();
  const deadline = last.simTime + seconds;
  const note = (snap: FathomSnapshot): void => {
    if (snap.screen !== "countdown") return;
    for (const predator of snap.predators) {
      if (predator.released === true && !loose.includes(predator.kind)) {
        loose.push(predator.kind);
      }
    }
  };

  note(last);
  while (last.screen === "countdown" && last.simTime < deadline) {
    await h.advance(WATCH_POLL);
    last = h.snapshot();
    note(last);
  }
  return { loose, last };
}

/** The time the schedule gives the `slot`-th release, in seconds from play. */
export function dueAt(slot: number): number {
  return slot * DEN_RELEASE_GAP;
}

/** How long a whole roster's schedule is watched for, in seconds. */
export function watchSeconds(count: number): number {
  return dueAt(count - 1) + RELEASE_GRACE;
}

/** The kinds the schedule releases in, as one readable line. */
export function orderLine(kinds: readonly string[]): string {
  return kinds.length > 0 ? kinds.join(" → ") : "(none left the den)";
}

/** The order `specs/predators.md` fixes, as one readable line. */
export const DEN_ORDER_LINE = orderLine(DEN_ORDER as readonly string[]);
