// Automated validation for pathing.map-c-housings: on The Transformer Yard the two housing
// rectangles are pre-blocked and never buildable, while the base waypoint route is open.
//
// Housing 1 spans tiles (12,6)..(19,12) (`specs/board.md`). A rock is pulled from the press and
// held over the middle of it, where the footprint cue must read ILLEGAL; the drop is then
// attempted and nothing lands.
//
// WHAT THE STILL SHOWS. The old script drove a bare `placeRock` into the housing and captured the
// board afterwards. A refused placement leaves the board exactly as it was, so the still was an
// untouched yard — a picture of nothing happening, which is indistinguishable from a build that
// was never asked. The evidence a reviewer needs is the REFUSAL being shown: the held rock
// hovering over the housing with its illegal cue lit (`#ff4d4d`, `specs/controls.md`). So the
// press is pulled and the pointer parked on the housing BEFORE the capture, and the ghost's own
// legality read is asserted alongside the refusal.
//
// Opening the run on the map is the arrange; pulling the press, hovering the housing, and the
// REFUSED drop are the behavior under test and are the act.

import { startBuild, snap, tileCenter, TILE } from "../_helpers.mjs";

// The middle of Housing 1 (`col 12..19` by `row 6..12`): a 2x2 anchored here is wholly inside it.
const HOUSING = { col: 14, row: 8 };
// A real pause so the build's own frame loop draws the held ghost before the still is taken. The
// ghost is PAINTED from hover state, and instant stepping paints nothing — the same reason
// `readPanel` waits rather than steps. Generous, since a headless browser may throttle frames.
const PAINT_MS = 300;

export default function item() {
  // The opening board, the held ghost over the housing, and the board after the refused drop.
  let s0;
  let held;
  let s1;

  return {
    id: "pathing.map-c-housings",

    async arrange(api) {
      s0 = await startBuild(api, { map: "transformer" });
    },

    async act(api) {
      // Pull the press the way a player does (`B`, `specs/controls.md`) and park the pointer on
      // the housing, so the still shows the illegal footprint cue over it.
      await api.call("press", "KeyB");
      const c = tileCenter(HOUSING.col, HOUSING.row);
      // The pointer goes to the middle of the 2x2 footprint, so the anchor snaps to HOUSING.
      await api.call("pointerMove", c.x + TILE / 2, c.y + TILE / 2);
      await api.settle(PAINT_MS);
      held = (await snap(api)).held;
      await api.screenshot("housings");

      // Then attempt the drop and confirm the housing refused it.
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", HOUSING.col, HOUSING.row);
      s1 = await snap(api);
    },

    async assert(api, check) {
      check.expectEq("the run is on The Transformer Yard", s0.map, "transformer");
      check.expectGt("the base waypoint route is open (a finite maze length)", s0.mazeLength, 0);
      check.expectOk("a rock is held over the fixed housing", Boolean(held && held.active));
      check.expectOk(
        "...and its footprint cue reads illegal there",
        Boolean(held) && held.legal === false,
      );
      check.expectEq(
        "a placement on a fixed housing lands no candidate",
        s1.towers.length,
        s0.towers.length,
      );
      check.expectEq("...and consumes no stamp", s1.stampsLeft, s0.stampsLeft);
    },
  };
}
