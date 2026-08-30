// Automated validation for pathing.flyer-ignores-maze: the Filament flies a straight line
// over the walls from the Entry through the waypoints to the Collector.
//
// On the default map the Entry (0,5) and WP1 (44,5) share row 5, so the flyer's straight line
// runs along y=166. Walls dropped on that corridor would divert a ground unit; the flyer's y
// must stay constant as its x advances — it ignores the maze.
//
// WHERE THE CLIP SITS. The walls are at column 20, around x=400-440, and a Filament leaves the
// Entry at x=10 and flies at 85 px/s — so it does not reach them for about four and a half
// seconds. The old script simply advanced three seconds from the release, which meant the whole
// clip was the flyer crossing empty yard and it ENDED before it got anywhere near an obstacle:
// the one thing the item is about was never on screen. The approach is skipped instead (instant
// in both passes, so the verdict is untouched) and the window opens with the walls just ahead,
// so what the clip shows is the flyer crossing them.
//
// Walling the corridor, releasing the Filament and flying it up to the walls are the arrange.
// The crossing itself is both the behavior under test and the thing worth watching, so it is
// the act.

import {
  startBuild,
  placeCandidate,
  spawnControlled,
  unitById,
  snap,
  SECOND,
} from "../_helpers.mjs";

// The walled column, and where the clip picks the flyer up: far enough short of the walls to
// see it arrive, close enough that it is not a wait.
const WALL_COL = 20;
const WALL_X = 20 * WALL_COL; // 400 px — the left edge of the walled footprints
const OPEN_AT_X = WALL_X - 120;
// Long enough to carry the flyer well past the far side of the walls (85 px/s).
const FLIGHT_TICKS = 4 * SECOND;

export default function item() {
  // The flyer as it came up on the walls, and as it stood after crossing them.
  let f;
  let start;
  let live;

  return {
    id: "pathing.flyer-ignores-maze",

    async arrange(api) {
      await startBuild(api);
      // Wall the ground corridor heavily (still non-sealing).
      await placeCandidate(api, "capacitor", 1, WALL_COL, 4);
      await placeCandidate(api, "capacitor", 1, WALL_COL, 7);

      [f] = await spawnControlled(api, "filament");

      // Fly it up to the walls without filming the empty approach.
      await api.skipUntil((s) => (unitById(s, f.id)?.x ?? 0) >= OPEN_AT_X, {
        max: 30 * SECOND,
        poll: 3,
      });
      start = unitById(await snap(api), f.id);
    },

    async act(api) {
      await api.advance(FLIGHT_TICKS);
      live = unitById(await snap(api), f.id);
    },

    async assert(api, check) {
      check.expectOk("the Filament is airborne", f.flying === true);
      check.expectOk("the flyer reached the walled stretch of the corridor", !!start && start.x >= OPEN_AT_X);
      check.expectOk("the flyer is still mid-flight", !!live && live.flying);
      check.expectClose("the flyer flies straight over the walls (its y is unchanged)", live.y, start.y, 6);
      check.expectGt("...while advancing toward the waypoint over the walls", live.x, WALL_X + 40);
    },
  };
}
