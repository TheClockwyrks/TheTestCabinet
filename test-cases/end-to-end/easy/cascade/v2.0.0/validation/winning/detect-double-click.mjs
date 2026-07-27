// Automated validation for the Winning sub-item `detect-double-click`.
//
// Double-clicking the last card sends it home (specs/rules.md), which completes all
// four foundations and must be detected as a win exactly as dragging it home is:
// normal play stops and the victory cascade begins — and is still running once the
// gesture is over. Both places a player can double-click that last card are covered,
// the waste and a tableau column.
//
// "Once the gesture is over" is the whole point of this item, and is why it exists
// alongside `detect-drag` rather than being folded into it. A double-click ends with
// the pointer coming back up, and on the won screen a click deals a fresh game
// (specs/states.md). A build that recognizes the double-click on the second PRESS
// therefore wins mid-gesture and then has its own release land on the won screen; if
// that release is treated as an ordinary click, the build deals a new game and the
// victory cascade never plays at all — while every rules-level check still passes,
// because the win itself was detected correctly. `actWinByDoubleClick` completes the
// gesture, and the post-cascade assertions are what catch it.
//
// The first near-win board is the precondition (`arrange`, which owns the reset);
// the double-clicks that win, and the cascades they fire, are what `act` films.
// `act` re-poses for the second scenario, which the runtime supports: it hands the
// build's clock back after a reset, so a re-pose means the same thing in both passes.

import {
  actWinByDoubleClick,
  checkWinFires,
  lastCardPoint,
  poseNearWin,
} from "../_helpers.mjs";

// Where the last card waits, in the order the clip shows them.
const SOURCES = ["waste", "tableau"];

export default function item() {
  // The pre-gesture snapshot and the win result, per source.
  const before = {};
  const won = {};
  let posed;

  return {
    id: "winning.detect-double-click",

    async arrange(api) {
      posed = await poseNearWin(api, SOURCES[0]);
    },

    async act(api) {
      for (const source of SOURCES) {
        // The first board is already posed by `arrange`; the game is won by the
        // time the second scenario starts, so that one is posed fresh here.
        const snap =
          source === SOURCES[0] ? posed : await poseNearWin(api, source);
        before[source] = snap;
        won[source] = await actWinByDoubleClick(
          api,
          lastCardPoint(snap, source),
        );
      }
    },

    async assert(api, check) {
      checkWinFires(
        check,
        "double-clicked on the waste",
        before.waste,
        won.waste,
      );
      checkWinFires(
        check,
        "double-clicked on a column",
        before.tableau,
        won.tableau,
      );
    },
  };
}
