// fog.light-reveals-walls: the walls the passive light lands on become revealed rock.
//
// Entering play and widening the light is instant (`arrange`); the moment the light needs
// to fall on the surrounding rock is `act`, along with the paint settle for the capture.
import { startPlaying } from "../_helpers.mjs";

export default function item() {
  let revealedWalls = 0;

  return {
    id: "fog.light-reveals-walls",

    async arrange(api) {
      await startPlaying(api);
      await api.call("setBrightness", 1); // widen the light so it reaches surrounding walls
    },

    async act(api) {
      await api.advance(12); // 12 ticks = the old 0.1 s
      const s = await api.snapshot();
      for (let r = 0; r < s.grid.rows; r++) {
        for (let c = 0; c < s.grid.cols; c++) {
          if (
            s.tiles[r][c] === "#" &&
            (s.visibility[r][c] === "l" || s.visibility[r][c] === "r")
          ) {
            revealedWalls++;
          }
        }
      }
      await api.settle(100); // a REAL pause (the old wait(100)) so the still is painted
      await api.screenshot("walls");
    },

    async assert(api, check) {
      check.expectGt(
        "the light reveals the walls it lands on",
        revealedWalls,
        0,
      );
    },
  };
}
