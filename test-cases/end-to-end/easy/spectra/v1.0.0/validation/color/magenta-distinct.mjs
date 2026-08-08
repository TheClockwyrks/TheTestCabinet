// Automated validation for the Color sub-item `magenta-distinct`.
//
// A magenta-band drone renders in a distinct, visible color, clearly different from
// a cyan drone and from the field background. The pixels the build actually PAINTS
// are sampled, so a build cannot pass by claiming a color it does not draw.

//
// WHY THE BAND IS READ BY SATURATION, NOT BRIGHTNESS. `sampleVivid` returns the
// BRIGHTEST painted pixel in a box, and a drone is not uniformly its band color:
// the provided sprites carry a hot near-white core inside the band-tinted body and
// glow. On a build drawn that way the brightest pixel of a cyan drone and of a
// magenta one are both near-white, so the two sampled 14 apart on a 0..441 scale
// and the item failed a build whose drones a person can tell apart instantly —
// while a build with muddier, less separated band colors passed, because its
// darker sprites let the sampler find the tint.
//
// `sampleSaturated` reads the most CHROMATIC pixel bright enough to carry a hue,
// which is the part that actually swaps with the band. `color/ship-band` already
// samples this way, for the same reason and in the same words: the fighter's white
// hull is its brightest pixel but its band is told by the tinted accents. Drones
// have the same problem and were still on the old sampler.
//
// The background is still read with `sampleVivid`: it is a near-black empty field
// with no hue to find, and what that comparison asks is whether the drone is
// brighter than nothing, not what color the nothing is.

import {
  startStageClean,
  spawnDrone,
  sampleVivid,
  sampleSaturated,
  colorDistance,
} from "../_helpers.mjs";

const VISIBLE_MIN = 60;
const DISTINCT_MIN = 40;

export default function item() {
  // The three sampled colors, read from the painted canvas in `act`.
  let cyan;
  let magenta;
  let bg;

  return {
    id: "color.magenta-distinct",

    // One drone of each band side by side, on an otherwise empty field.
    async arrange(api) {
      await startStageClean(api, 1);
      await api.call("setShipX", 640);
      await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 400,
        y: 300,
        phase: "formation",
      });
      await spawnDrone(api, {
        kind: "shard",
        band: "magenta",
        x: 800,
        y: 300,
        phase: "formation",
      });
    },

    // The scene is static, so the only thing `act` needs is a painted frame to read.
    // `settle` is a real pause in both passes and is the only way to get one in the
    // validate pass, where advancing time is instant and paints nothing.
    async act(api) {
      await api.settle(120);
      cyan = await sampleSaturated(api, 380, 280, 420, 320);
      magenta = await sampleSaturated(api, 780, 280, 820, 320);
      bg = await sampleVivid(api, 600, 440, 680, 500);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "a magenta drone is drawn in a visible color (RGB distance from the field background)",
        colorDistance(magenta, bg),
        VISIBLE_MIN,
      );
      check.expectGt(
        "a magenta drone is distinct from a cyan drone (RGB distance between the two)",
        colorDistance(magenta, cyan),
        DISTINCT_MIN,
      );
    },
  };
}
