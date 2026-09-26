// pathing/targets-platform-anchor — a unit heading for a waypoint walks to the
// platform's ANCHOR tile, not to whichever of its four tiles it meets first.
//
// A platform is four tiles wide so that it can never be walled off
// (`specs/yard.md`), and `specs/pathing.md` fixes the target inside it: the
// anchor tile. The distinction is worth a point of its own because it changes the
// route's shape and its length — a unit that turns at an arm cuts a tile or two
// off every leg, so the maze the player built is quietly shorter than the figure
// the status bar reports.
//
// EACH WAYPOINT IS READ ON ITS OWN, and each on a unit posed two tiles short of
// the anchor so the arrival is the only thing that happens: the frame its
// `waypointIndex` advances is the frame it reached the checkpoint, and its
// position on that frame has to be within half a tile of the anchor's centre.

import { afterEach, beforeEach, it } from "vitest";
import { mapById, type Point, TILE, tileCenter } from "../constants";
import { assertLessThanOrEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  distance,
  type Harness,
  openYard,
  releaseUnit,
} from "../harness";

/** How far short of the anchor each unit is posed, in tiles. */
const APPROACH_TILES = 2;

/** How long one approach is given, in seconds of simulation. */
const APPROACH_SECONDS = 4;

/**
 * The rate the six approaches are covered at.
 *
 * Each is a SPAN — two tiles of walking — rather than a reading, and
 * specs/instrumentation.md guarantees that "an interval of simulation time
 * reaches the same state however it was divided into frames and whatever frame
 * rate produced it". A Mote steps `2` units a frame at this rate, a fifth of the
 * half tile the arrival is read within, and nothing here is a projectile.
 */
const APPROACH_HZ = 30;

/** The tolerance the item states: half a tile. */
const TOLERANCE = TILE / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: APPROACH_HZ });
});

afterEach(() => {
  h?.dispose();
});

it("arrives within half a tile of each platform's anchor centre", async () => {
  openYard(h, { wave: 1 });
  const map = mapById(h.snapshot().map);

  const arrivals = await captureReplay(h, "anchor", async () => {
    const reached: { waypoint: number; at: Point | null }[] = [];

    for (const [index, anchor] of map.waypoints.entries()) {
      const waypoint = index + 1;
      // One unit at a time, posed a short walk west of the anchor, heading for
      // the checkpoint under test and nothing else on the yard.
      h.debug.clearUnits();
      const id = releaseUnit(h, "mote", {
        waypoint,
        tile: { col: anchor.col - APPROACH_TILES, row: anchor.row },
      });

      let arrived: Point | null = null;
      const approach = h.ticks(APPROACH_SECONDS);
      for (let frame = 0; frame < approach && arrived === null; frame += 1) {
        await h.advance(1);
        const unit = h.snapshot().units.find((live) => live.id === id);
        if (unit === undefined) break;
        if (unit.waypointIndex > waypoint) arrived = { x: unit.x, y: unit.y };
      }
      reached.push({ waypoint, at: arrived });
    }

    return reached;
  });

  for (const arrival of arrivals) {
    const anchor = map.waypoints[arrival.waypoint - 1]!;
    const centre = tileCenter(anchor.col, anchor.row);
    assertTrue(
      arrival.at !== null,
      `the unit heading for WP${arrival.waypoint} to reach it within ` +
        `${APPROACH_SECONDS}s of walking ${APPROACH_TILES} tiles`,
    );
    assertLessThanOrEqual(
      distance(arrival.at!, centre),
      TOLERANCE,
      `WP${arrival.waypoint}: the distance from where the unit stood on the ` +
        `frame it passed the checkpoint to the centre of its anchor tile ` +
        `(${anchor.col}, ${anchor.row}), which specs/pathing.md makes the tile ` +
        `a unit targets`,
    );
  }
});
