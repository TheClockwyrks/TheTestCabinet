// Automated validation for the Sizes sub-item `footprints`.
//
// Arc, Stutter, Rime, Flak, Forge, and Sink are 2x2; the Bloom is 3x3; the Lance is
// 4x4 (specs/towers.md). We place each type and read its reported footprint size.

import { newGame, build, tower } from "../_helpers.mjs";

const EXPECTED = {
  arc: 2,
  stutter: 2,
  rime: 2,
  flak: 2,
  forge: 2,
  sink: 2,
  bloom: 3,
  lance: 4,
};

export default function item() {
  const sizes = {};

  return {
    id: "sizes.footprints",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // Lay one of every type out across the floor, spaced so no footprint collides,
    // and read each reported size back. The still then shows all eight side by side.
    async act(api) {
      const spots = {
        arc: [2, 2],
        stutter: [2, 6],
        rime: [2, 10],
        flak: [2, 14],
        forge: [2, 18],
        sink: [2, 22],
        bloom: [10, 2],
        lance: [16, 2],
      };
      for (const [type, [col, row]] of Object.entries(spots)) {
        const id = await build(api, type, col, row);
        const t = await tower(api, id);
        sizes[type] = t ? t.size : -1;
      }
      await api.settle(80);
      await api.screenshot("sizes");
    },

    async assert(api, check) {
      for (const type of Object.keys(EXPECTED)) {
        check.expectEq(`${type} footprint size`, sizes[type], EXPECTED[type]);
      }
    },
  };
}
