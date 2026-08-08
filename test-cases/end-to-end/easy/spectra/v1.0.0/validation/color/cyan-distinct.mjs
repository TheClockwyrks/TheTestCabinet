// Automated validation for the Color sub-item `cyan-distinct`.
//
// A cyan-band drone renders in a distinct, visible color, clearly different from a
// magenta drone and from the field background. The pixels the build actually PAINTS
// are sampled (see _helpers.mjs — this reads the canvas, not a value the game
// reports), so a build cannot pass by claiming a color it does not draw. The exact
// hue is the model's own; only the distinctness is scored.
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

// Both thresholds are Euclidean RGB distances (`colorDistance`), on a 0..441 scale.
const VISIBLE_MIN = 60; // clearly different from the near-black field
const DISTINCT_MIN = 40; // clearly different from the other band

export default function item() {
  // The three sampled colors, read from the painted canvas in `act`.
  let cyan;
  let magenta;
  let bg;

  return {
    id: "color.cyan-distinct",

    // One drone of each band, side by side on an otherwise empty field, so each is
    // sampled against a known-clear patch of background.
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

    // No simulation time is needed — the scene is already posed. What IS needed is a
    // painted frame: `settle` is a real pause in both passes, and in the validate
    // pass it is the only thing that produces one (advancing is instant and paints
    // nothing), so without it the sample races the renderer.
    async act(api) {
      await api.settle(120); // let a frame paint the posed scene
      cyan = await sampleSaturated(api, 380, 280, 420, 320);
      magenta = await sampleSaturated(api, 780, 280, 820, 320);
      bg = await sampleVivid(api, 600, 440, 680, 500);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "a cyan drone is drawn in a visible color (RGB distance from the field background)",
        colorDistance(cyan, bg),
        VISIBLE_MIN,
      );
      check.expectGt(
        "a cyan drone is distinct from a magenta drone (RGB distance between the two)",
        colorDistance(cyan, magenta),
        DISTINCT_MIN,
      );
    },
  };
}
