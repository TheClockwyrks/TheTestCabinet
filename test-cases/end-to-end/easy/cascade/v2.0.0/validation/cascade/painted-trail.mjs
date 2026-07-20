// Automated validation for the Victory-cascade sub-item `painted-trail`.
//
// Each in-flight card is drawn onto a persistent layer that is never cleared, so the
// table fills with dense arcs of overlapping cards (specs/victory.md). This reads the
// pixels the build actually PAINTS (api.pixel): after advancing the cascade well past
// all launches, points across the lower table — far from the foundations at the top —
// must show painted card pixels rather than bare felt.
//
// UNITS: 12 s of cascade is 12 x 120 = 1440 ticks exactly. The pause that follows is
// `api.settle`, not a further advance: a pixel read needs a PAINTED frame, and
// advancing simulation time produces none (in the validate pass it consumes no wall
// clock at all). `settle` is real milliseconds in both passes, so the 150 ms carries
// over unconverted.

import {
  SECOND,
  colorDistance,
  FELT,
  sampleColor,
  winBoard,
} from "../_helpers.mjs";

const NOT_FELT = 60; // clearly a painted card pixel, not the green felt

// The trail this item checks only exists once the launches have finished, so `act`
// genuinely needs more than the default 8 s of filming budget — without this the
// record pass would be cut off mid-cascade and never reach the `trail` capture. 13 s
// covers the 12 s advance and the paint settle after it.
const CLIP_MS = 13000;

export default function item() {
  // How many of the sample points came back painted rather than bare felt.
  let painted;

  return {
    id: "cascade.painted-trail",

    clipMs: CLIP_MS,

    async arrange(api) {
      await winBoard(api, 11);
    },

    async act(api) {
      // Run the cascade far enough that all 52 cards have launched and painted across the
      // floor band (launches finish by ~9.4 s; the trail persists thereafter).
      await api.advance(12 * SECOND);
      await api.settle(150); // let a frame render the accumulated trail

      // Sample points well below the foundations: three along the floor band and one
      // higher in the arc region.
      const points = [
        [300, 650],
        [640, 650],
        [980, 650],
        [640, 520],
      ];
      painted = 0;
      for (const [x, y] of points) {
        const c = await sampleColor(api, x, y);
        if (colorDistance(c, FELT) > NOT_FELT) painted += 1;
      }

      await api.screenshot("trail");
    },

    async assert(api, check) {
      check.expectGe(
        "the painted trail fills the lower table with card pixels (not bare felt)",
        painted,
        3,
      );
    },
  };
}
