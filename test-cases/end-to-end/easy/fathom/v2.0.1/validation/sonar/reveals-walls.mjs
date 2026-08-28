// sonar.reveals-walls: a pulse reveals the corridors it floods and the walls bounding
// them (more revealed walls after the pulse than from passive light alone).
//
// The baseline (passive light only) and the flood that follows both need the sim to run,
// so the whole comparison is `act`; the capture at the end is the reviewer's evidence.
import { startPlaying } from "../_helpers.mjs";

function revealedWalls(s) {
  let n = 0;
  for (let r = 0; r < s.grid.rows; r++) {
    for (let c = 0; c < s.grid.cols; c++) {
      if (
        s.tiles[r][c] === "#" &&
        (s.visibility[r][c] === "l" || s.visibility[r][c] === "r")
      ) {
        n++;
      }
    }
  }
  return n;
}

export default function item() {
  let before;
  let after;

  return {
    id: "sonar.reveals-walls",

    async arrange(api) {
      await startPlaying(api);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s: passive light only
      before = revealedWalls(await api.snapshot());
      await api.call("clearCooldowns");
      await api.call("press", "Space");
      await api.advance(120); // 120 ticks = the old 1.0 s: let the full pulse flood the corridors
      after = revealedWalls(await api.snapshot());
      await api.settle(100); // a REAL pause (the old wait(100)) so the still is painted
      await api.screenshot("walls");
    },

    async assert(api, check) {
      check.expectGt("the sonar pulse reveals additional walls", after, before);
    },
  };
}
