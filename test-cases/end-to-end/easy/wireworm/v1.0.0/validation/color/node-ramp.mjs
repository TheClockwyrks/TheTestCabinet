// Automated validation for color.node-ramp: the four node charge states render as
// distinct colors that brighten from inert (dark) to critical (brightest).
//
// Four nodes at charges 0..3 are posed at known tiles and the rendered pixels are
// sampled (api.pixel — reads the canvas, not a reported value). Each state is
// distinct from the others, and the critical node is clearly brighter than the inert
// one. The exact hues are the model's own; only the ramp is scored.

import {
  brightness,
  colorDistance,
  freshBoard,
  sampleColor,
  tileCX,
  tileCY,
} from "../_helpers.mjs";

const DISTINCT = 20; // clearly different charge states
const BRIGHTEN = 20; // critical clearly brighter than inert

export default function item() {
  let c0;
  let c1;
  let c2;
  let c3;

  return {
    id: "color.node-ramp",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", 8, 8, 0);
      await api.call("setNode", 12, 8, 1);
      await api.call("setNode", 16, 8, 2);
      await api.call("setNode", 20, 8, 3);
    },

    // The sampling lives here because it reads PAINTED pixels: `api.settle` is a
    // real pause in both passes, so a frame has landed since the nodes were posed.
    async act(api) {
      await api.settle(180);
      c0 = await sampleColor(api, tileCX(8), tileCY(8));
      c1 = await sampleColor(api, tileCX(12), tileCY(8));
      c2 = await sampleColor(api, tileCX(16), tileCY(8));
      c3 = await sampleColor(api, tileCX(20), tileCY(8));
      await api.screenshot("ramp");
    },

    async assert(api, check) {
      check.expectGt(
        "inert and charge-1 render distinctly",
        colorDistance(c0, c1),
        DISTINCT,
      );
      check.expectGt(
        "charge-1 and charge-2 render distinctly",
        colorDistance(c1, c2),
        DISTINCT,
      );
      check.expectGt(
        "charge-2 and critical render distinctly",
        colorDistance(c2, c3),
        DISTINCT,
      );
      check.expectGt(
        "inert and critical render distinctly",
        colorDistance(c0, c3),
        DISTINCT,
      );
      check.expectGt(
        "the critical node is brighter than the inert node",
        brightness(c3) - brightness(c0),
        BRIGHTEN,
      );
    },
  };
}
