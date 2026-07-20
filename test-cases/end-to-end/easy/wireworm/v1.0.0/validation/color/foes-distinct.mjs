// Automated validation for color.foes-distinct: the glitch, dropper, and corruptor
// each render in a color distinct from one another and from the board background.
//
// One of each foe is posed at a known spot and the rendered pixels sampled
// (api.pixel). The three foe colors must stand apart from each other and from an
// empty patch of board.

import {
  colorDistance,
  freshBoard,
  sampleColor,
  tileCX,
  tileCY,
} from "../_helpers.mjs";

const DISTINCT = 40;

export default function item() {
  let glitch;
  let dropper;
  let corruptor;
  let bg;

  return {
    id: "color.foes-distinct",

    async arrange(api) {
      await freshBoard(api);
      await api.call("spawnFoe", "glitch", {
        x: tileCX(10),
        y: tileCY(5),
        vx: 0,
      });
      await api.call("spawnFoe", "dropper", { x: tileCX(20), y: tileCY(8) });
      await api.call("spawnFoe", "corruptor", { row: 3, x: tileCX(30), vx: 0 });
    },

    // The sampling lives here because it reads PAINTED pixels: `api.settle` is a
    // real pause in both passes, so a frame has landed since the foes were posed.
    // In the validate pass the build is on its manual clock, so the foes are still
    // exactly where they were posed when each is sampled.
    async act(api) {
      await api.settle(180);
      glitch = await sampleColor(api, tileCX(10), tileCY(5));
      dropper = await sampleColor(api, tileCX(20), tileCY(8));
      corruptor = await sampleColor(api, tileCX(30), tileCY(3));
      bg = await sampleColor(api, tileCX(35), tileCY(11));
      await api.screenshot("foes");
    },

    async assert(api, check) {
      check.expectGt(
        "the glitch is distinct from the dropper",
        colorDistance(glitch, dropper),
        DISTINCT,
      );
      check.expectGt(
        "the glitch is distinct from the corruptor",
        colorDistance(glitch, corruptor),
        DISTINCT,
      );
      check.expectGt(
        "the dropper is distinct from the corruptor",
        colorDistance(dropper, corruptor),
        DISTINCT,
      );
      check.expectGt(
        "the glitch is distinct from the board",
        colorDistance(glitch, bg),
        DISTINCT,
      );
      check.expectGt(
        "the dropper is distinct from the board",
        colorDistance(dropper, bg),
        DISTINCT,
      );
      check.expectGt(
        "the corruptor is distinct from the board",
        colorDistance(corruptor, bg),
        DISTINCT,
      );
    },
  };
}
