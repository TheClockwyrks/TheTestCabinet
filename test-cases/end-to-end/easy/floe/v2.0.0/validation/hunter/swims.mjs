// Automated validation for the Hunter item `swims`.
//
// Over open water the bear swims, and it moves slower swimming than it does on ice.
// A bear is placed on cleared open water (swimming) and then on cleared ice, and
// its per-step displacement toward the same target is compared. See _helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

// Let the bear commit a step, so `swimming` is set from the footing it is actually
// standing on. The old script used 0.08 s, which is 9.6 ticks — not a whole tick, and
// the tick contract throws rather than rounding. This is a settle rather than a
// measured duration (nothing compares it to anything), so it rounds UP to 10 ticks
// (0.0833 s): the bear definitely commits, and rounding down could leave it mid-step.
// Both scenarios use the same value, so the swim/ice comparison stays symmetric.
const COMMIT_TICKS = 10;

// The measured span, identical for both footings so the displacements are comparable.
//
// A SECOND EACH, BECAUSE THE CLIP IS THE COMPARISON. `act` is the recording, and the
// claim here is a difference in SPEED — which a reviewer can only judge by watching the
// bear cover ground twice and seeing one take longer. At the old 0.15 s each footing was
// about eighteen frames and roughly a third of a tile of travel: correct, unwatchable,
// and impossible to compare. A second each makes the swim visibly the slower of the two.
// The span is what the assertion divides by, so lengthening it does not loosen anything:
// both footings still get exactly the same span, and a longer one is a longer lever on
// the difference, not a shorter one.
const MEASURE_TICKS = 108; // 0.9 s

// The open-water pocket the swim is measured in, bottom row last, and the cleared-ice
// pocket the walk is measured in. Both are deep enough that the bear is still on the
// footing being measured when the span ends (see `arrange`), the ice one deeper because
// the bear covers more ground on it.
const SWIM_ROWS = [3, 4, 5, 6, 7, 8];
const ICE_ROWS = [11, 12, 13, 14, 15, 16, 17];

// How far the bear must actually cover on EACH footing for the comparison to mean
// anything, in px.
//
// THE COMPARISON IS SATISFIED BY A BEAR THAT NEVER SWIMS. "Swimming is slower than
// moving on ice" is `swimDisp < iceDisp`, and a build whose pursuit is stuck in the
// water reports `swimDisp` of exactly 0 — which is less than any ice figure, so it wins
// the item without the bear ever having swum a pixel, on the strength of the defect. One
// of the two builds this was audited against does exactly that. A floor on both sides is
// what makes the item say "it swims, and it swims slower" rather than only the second
// half. specs/hunter.md fixes the speeds at about 2 and 3 tiles/second, so over the
// measured span a conformant build covers ~58 px swimming and ~86 px on ice; half a tile
// is far below either and far above a bear that is merely twitching.
const MIN_DISP_PX = 16;

export default function item() {
  // What each footing measured, for `assert` to compare.
  let swimming;
  let swimDisp;
  let onIceSwimming;
  let iceDisp;

  return {
    id: "hunter.swims",

    // Pose the swim: the critter up top on a floe so the bear has a target to move
    // toward, the water rows below it cleared to open water, and the bear at the bottom
    // of them.
    //
    // THE CLEARED RUN HAS TO OUTLAST THE MEASUREMENT. At 2 tiles/second a second of
    // swimming is nearly two tiles, so a three-row pocket would put the bear onto the
    // next populated lane partway through — and a bear that climbs onto a floe stops
    // swimming and speeds up, which would fold some ice-speed travel into the number
    // this item calls the swim. The pocket is sized so the bear is still in open water
    // when the span ends.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLane", WATER_TOP, { cols: [20], speed: 0 }); // safe target up top for the critter
      await api.call("placeCritter", 20, WATER_TOP);
      for (const r of SWIM_ROWS) await api.call("setLane", r, { cols: [] }); // open water
      await api.call("setBear", 0, {
        col: 20,
        row: SWIM_ROWS[SWIM_ROWS.length - 1],
      });
    },

    // Measure the same pursuit over the same span on each footing: first swimming
    // across open water, then walking on cleared ice. The move between them is
    // control ops only (`setLane` / `setBear`) — no reset, which would freeze the
    // recording. Both footings in one clip is also what makes the difference legible.
    async act(api) {
      await api.advance(COMMIT_TICKS);
      swimming = (await api.snapshot()).bears[0].swimming;
      const yA = (await api.snapshot()).bears[0].y;
      await api.advance(MEASURE_TICKS);
      swimDisp = Math.abs((await api.snapshot()).bears[0].y - yA);

      // Now the same pursuit on ice, over an equally long cleared run — at 3
      // tiles/second the bear covers more ground in the span than it does swimming, so
      // the ice pocket has to be the deeper of the two.
      for (const r of ICE_ROWS) await api.call("setLane", r, { cols: [] });
      await api.call("setBear", 0, {
        col: 20,
        row: ICE_ROWS[ICE_ROWS.length - 1],
      });
      await api.advance(COMMIT_TICKS);
      onIceSwimming = (await api.snapshot()).bears[0].swimming;
      const yB = (await api.snapshot()).bears[0].y;
      await api.advance(MEASURE_TICKS);
      iceDisp = Math.abs((await api.snapshot()).bears[0].y - yB);
    },

    async assert(api, check) {
      check.expectEq("the bear over open water is swimming", swimming, true);
      check.expectEq("the bear on ice is not swimming", onIceSwimming, false);
      check.expectGt(
        "the bear actually crossed the open water (not stuck in it)",
        swimDisp,
        MIN_DISP_PX,
      );
      check.expectGt(
        "the bear actually travelled on the ice (not stuck on it)",
        iceDisp,
        MIN_DISP_PX,
      );
      check.expectLt(
        "swimming is slower than moving on ice",
        swimDisp,
        iceDisp,
      );
    },
  };
}
