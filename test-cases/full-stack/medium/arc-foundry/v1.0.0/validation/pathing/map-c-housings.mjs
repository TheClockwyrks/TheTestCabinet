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
// WHY THE GHOST'S POSITION IS NOW ASSERTED. Reading `held.legal` alone is not enough to know the
// still shows anything. A build whose `pointerMove` records a pointer but never moves the held
// ghost — which `specs/instrumentation.md` requires it to do, "updating the held-stamp ghost and
// hover state" — leaves the rock wherever it was armed, and a build that also reports the ghost
// as illegal by default then satisfies every assertion here while the still shows a rock sitting
// in the corner of the yard, nowhere near a housing. That is exactly what one run implementation
// did, and this item passed it.
//
// So the ghost's own footprint is checked to lie inside the housing rectangle. The test is on
// where the ghost IS rather than on an exact anchor, because `specs/board.md` says only that the
// preview "snaps the 2x2 block to the grid under the cursor" and does not pin whether the anchor
// is the tile under the pointer or the block is centred on it. The housing is 8x7 tiles and the
// pointer is parked well inside it, so either reading lands the whole footprint within it.
//
// Opening the run on the map is the arrange; pulling the press, hovering the housing, and the
// REFUSED drop are the behavior under test and are the act.

import { startBuild, hoverHeldRock, snap } from "../_helpers.mjs";

// Housing 1 spans `col 12..19` by `row 6..12` (`specs/board.md`). The pointer is parked at (14,8),
// three tiles inside its left edge and two below its top, so a 2x2 that snaps either way is
// wholly within the rectangle.
const HOUSING = { col: 14, row: 8 };
const HOUSING_RECT = { col0: 12, col1: 19, row0: 6, row1: 12 };

export default function item() {
  // The opening board, the held ghost over the housing, and the board after the refused drop.
  let s0;
  let held;
  let s1;

  return {
    id: "pathing.map-c-housings",

    async arrange(api) {
      s0 = await startBuild(api, { map: "transformer" });

      // Pull the press the way a player does (`B`, `specs/controls.md`), park the pointer on the
      // housing, and capture the ghost hovering there.
      //
      // WHY THE HOVER AND THE STILL ARE IN `arrange`. A held ghost is drawn from the game's
      // pointer, and a build is entitled to let the REAL mouse own that pointer while it is
      // running on its own clock — the debug pointer is what a DRIVEN scenario uses, which is the
      // manual clock. The reference does exactly that, and says so in `main.ts`. The record pass
      // hands the build its own clock for `act`, so a hover posed there is overwritten by the
      // real mouse (which, headless, has never moved) before the next frame paints: `holding`
      // stays true and the inspector still reads PLACING ROCK, but the ghost is drawn nowhere and
      // the still shows an untouched yard. That is what the old capture was, and moving the
      // pointer in `act` did not change it.
      //
      // `arrange` runs before the runtime hands the clock over, so the debug pointer holds there
      // in BOTH passes and the ghost paints where it was put. `settle` is real time in both
      // passes, which is what gives the frame loop a chance to draw it; this item declares only
      // stills, so nothing is lost by capturing before the clock changes hands.
      held = await hoverHeldRock(api, HOUSING.col, HOUSING.row);
      await api.screenshot("housings");
    },

    async act(api) {
      // Attempt the drop and confirm the housing refused it.
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", HOUSING.col, HOUSING.row);
      s1 = await snap(api);
    },

    async assert(api, check) {
      check.expectEq("the run is on The Transformer Yard", s0.map, "transformer");
      check.expectGt("the base waypoint route is open (a finite maze length)", s0.mazeLength, 0);
      check.expectOk("a rock is held", Boolean(held && held.active));
      // Where the ghost actually went, so a build whose `pointerMove` never moved it cannot pass
      // on a still of a rock in the corner of the yard. Reported as the anchor either way, so a
      // failure names the tile the ghost was left on.
      const inHousing =
        Boolean(held && held.active) &&
        held.col >= HOUSING_RECT.col0 &&
        held.col + 1 <= HOUSING_RECT.col1 &&
        held.row >= HOUSING_RECT.row0 &&
        held.row + 1 <= HOUSING_RECT.row1;
      const where = held && held.active ? `(${held.col},${held.row})` : "nothing held";
      check.expectEq(
        "...and the pointer moved it over the fixed housing",
        where,
        inHousing
          ? where
          : `an anchor in cols ${HOUSING_RECT.col0}..${HOUSING_RECT.col1 - 1}, ` +
              `rows ${HOUSING_RECT.row0}..${HOUSING_RECT.row1 - 1}`,
      );
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
