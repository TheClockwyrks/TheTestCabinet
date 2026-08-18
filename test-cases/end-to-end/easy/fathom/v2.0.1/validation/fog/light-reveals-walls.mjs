// fog.light-reveals-walls: the walls the passive light lands on become revealed rock —
// and the light stops there, leaving what is behind them dark.
//
// Entering play, pinning the forager at the mouth of a short corridor and widening its
// light are instant (`arrange`); the moment the light needs to fall on that corridor's end
// wall is `act`, along with the paint settle for the capture.
//
// WHY IT NO LONGER JUST COUNTS REVEALED WALLS. This used to sweep the whole board and pass
// if a single wall tile anywhere had been revealed. Almost nothing fails that. A build
// that lights only the two rock faces it is directly sandwiched between — leaving the
// corridor it is looking down bounded by black fog a tile ahead — cleared it with two
// tiles to spare, and a reviewer reading a green line was told the light reveals the walls
// it lands on when it barely does. So the item now names a specific wall the light must
// land on, chosen so that no honest build can disagree that it does (see
// `findLitWallProbe`), and asks the other half of the same spec sentence too: the light
// "stops there", so the tile behind that wall must stay black.
import { findLitWallProbe, startPlaying } from "../_helpers.mjs";

export default function item() {
  let probe;
  let seen;

  const revealed = (tile) =>
    seen[tile.ty][tile.tx] === "l" || seen[tile.ty][tile.tx] === "r";

  return {
    id: "fog.light-reveals-walls",

    async arrange(api) {
      const snap = await startPlaying(api);
      probe = findLitWallProbe(snap);
      await api.call("setForager", {
        tx: probe.tx,
        ty: probe.ty,
        dir: probe.facing,
      });
      // Full glow: `V = 96 + 64 * G` (specs/gameplay.md), so the light reaches 160 px —
      // five tiles — and the corridor's end wall, at most four away, is well inside it.
      await api.call("setBrightness", 1);
    },

    async act(api) {
      await api.advance(12); // 12 ticks = the old 0.1 s
      seen = (await api.snapshot()).visibility;
      await api.settle(100); // a REAL pause (the old wait(100)) so the still is painted
      await api.screenshot("walls");
    },

    async assert(api, check) {
      check.expectOk(
        "the rock the forager is standing against is revealed",
        probe.flankWalls.every(revealed),
      );
      check.expectOk(
        `the light reveals the wall closing the corridor ${probe.run + 1} tiles ${probe.dir}`,
        revealed(probe.wall),
      );
      // Only a wall with a far side can be shown to have stopped the light. A corridor
      // that ends at the maze border has none, and `findLitWallProbe` falls back to one
      // only when the maze offers nothing else.
      if (probe.behind) {
        check.expectOk(
          "and stops there — the tile behind that wall stays black fog",
          !revealed(probe.behind),
        );
      }
    },
  };
}
