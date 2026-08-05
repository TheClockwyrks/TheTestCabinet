// Automated validation for the Winning sub-item `detect-double-click`.
//
// Double-clicking the last card sends it home (specs/rules.md), which completes all
// four foundations and must be detected as a win exactly as dragging it home is:
// normal play stops and the victory cascade begins — and is still running once the
// gesture is over. Both places a player can double-click that last card are covered,
// the waste and a tableau column.
//
// This exists alongside `detect-drag` rather than folded into it because the two are
// different input paths into the same rule: a drag commits on the release, over a
// target the player chose, while a double-click hands the card to the auto-move,
// which picks the foundation itself. A build can wire one correctly and the other
// not, and the win must fire either way.
//
// "Once the gesture is over" is the other half of the point, and is why the gesture
// is driven as a REAL browser double-click rather than through the `doubleClick`
// control op — the note on `actWinByDoubleClick` covers why, and why no composition
// of control ops substitutes for it. The `afterCascade` assertions are what catch a
// build that detects the win correctly and then tears it down an instant later, with
// its own gesture, before the cascade draws a frame.
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
