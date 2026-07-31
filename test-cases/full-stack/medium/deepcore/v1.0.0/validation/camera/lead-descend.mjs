// Automated validation for camera.lead-descend.
//
// A sustained descent rides the miner toward the top of the view (so what's below shows earlier) and
// a sustained climb toward the bottom, rather than pinning it dead-centre. We measure the miner's
// on-screen vertical position (as a fraction of the mine viewport) after a long fall and a long climb.

import {
  teleportInto,
  K,
  newRun,
  openColumn,
  solid,
  MINER_H,
  VIEWPORT_Y,
  TILE,
  SPAWN_COL,
} from "../_helpers.mjs";

const VIEWPORT_H = 664;

function screenFrac(snap) {
  const centerY = snap.miner.y + MINER_H / 2;
  return (VIEWPORT_Y + centerY - snap.camera.y - VIEWPORT_Y) / VIEWPORT_H;
}

export default function item() {
  const col = SPAWN_COL;
  let fall;
  let climb;

  return {
    id: "camera.lead-descend",

    // Pose the descent: the miner at the top of a long open shaft with a floor far below.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, 120);
      await openColumn(api, col, 121, 170);
      await solid(api, col, 171);
    },

    // Both sustained travels consume time, so both live here and both are filmed — the clip shows
    // the lead swinging from the top of the view to the bottom, which is exactly what is asserted.
    async act(api) {
      // Sustained descent. 150 ticks = 2.5 s.
      await api.advance(150);
      fall = screenFrac(await api.snapshot());

      // Sustained climb. Re-posed with control ops only — a reset here would take the clock back
      // and freeze the recording.
      await teleportInto(api, col, 300);
      await openColumn(api, col, 250, 300);
      await solid(api, col, 301);
      await api.call("setFuel", 999);
      await api.call("keyDown", K.thrust);
      await api.advance(150);
      climb = screenFrac(await api.snapshot());
      await api.call("keyUp", K.thrust);
    },

    async assert(api, check) {
      // Both readings are fractions DOWN THE MINE VIEWPORT, so "toward the top" and "toward the
      // bottom" are only meaningful for a miner that is on screen at all — 0 is the top edge and 1
      // the bottom. Bound each reading on BOTH sides before reading anything into it. A one-sided
      // bound quietly accepts nonsense: a camera that never followed the miner leaves it far below
      // the view at a fraction of 16, which is not "toward the bottom" in any sense a reviewer
      // would recognize, yet clears a bare `> 0.55` and reports the lead as working. That is worse
      // than a missing check, because it is a check that actively vouches for the broken case.
      check.expectOk(
        `a sustained fall rides the miner toward the top (${fall.toFixed(3)} down the viewport, wanted 0–0.45)`,
        fall >= 0 && fall < 0.45,
      );
      check.expectOk(
        `a sustained climb rides the miner toward the bottom (${climb.toFixed(3)} down the viewport, wanted 0.55–1)`,
        climb > 0.55 && climb <= 1,
      );
      // Bounded on both sides for the same reason: the swing between the two is a distance ACROSS
      // the viewport, so anything over 1 is off-screen travel rather than a lead reversing.
      check.expectOk(
        `the lead reverses direction with travel (swing of ${(climb - fall).toFixed(3)} of the viewport, wanted 0.15–1)`,
        climb - fall > 0.15 && climb - fall <= 1,
      );
      void TILE;
    },
  };
}
