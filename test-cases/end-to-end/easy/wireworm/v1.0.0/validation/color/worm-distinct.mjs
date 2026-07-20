// Automated validation for color.worm-distinct: the worm renders in a color clearly
// distinct from the board background and from the node color.
//
// A worm segment and a node are posed and the rendered pixels sampled (api.pixel).
// The worm's color must stand apart from both an empty patch of board and the node.

import {
  colorDistance,
  freshBoard,
  sampleColor,
  setWorm,
  tileCX,
  tileCY,
} from "../_helpers.mjs";

const DISTINCT = 45;

export default function item() {
  let worm;
  let node;
  let bg;

  return {
    id: "color.worm-distinct",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(
        api,
        [
          { c: 10, r: 8 },
          { c: 9, r: 8 },
          { c: 8, r: 8 },
        ],
        1,
        1,
      );
      await api.call("setNode", 20, 8, 2);
    },

    // The sampling lives here because it reads PAINTED pixels: `api.settle` is a
    // real pause in both passes, so a frame has landed since the worm was posed.
    // In the validate pass the build is on its manual clock, so the worm is still
    // on the tile it was posed on when the body segment is sampled.
    async act(api) {
      await api.settle(180);
      worm = await sampleColor(api, tileCX(9), tileCY(8)); // a body segment
      node = await sampleColor(api, tileCX(20), tileCY(8));
      bg = await sampleColor(api, tileCX(30), tileCY(8)); // empty board
      await api.screenshot("worm");
    },

    async assert(api, check) {
      check.expectGt(
        "the worm is distinct from the board background",
        colorDistance(worm, bg),
        DISTINCT,
      );
      check.expectGt(
        "the worm is distinct from the node color",
        colorDistance(worm, node),
        DISTINCT,
      );
    },
  };
}
