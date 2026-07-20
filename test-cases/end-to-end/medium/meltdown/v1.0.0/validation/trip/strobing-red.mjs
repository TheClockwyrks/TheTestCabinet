// Automated validation for the Trip sub-item `strobing-red`.
//
// While offline a tripped tower is drawn strobing red (specs/heat.md), so a gapped
// kill-box reads at a glance. The check trips a real emitter, then samples the
// pixels it actually RENDERS on its body — red must dominate both other channels
// (both strobe frames are red). Reading the rendered pixel means a build cannot pass
// by a color it does not draw. A Lance is used because its large footprint gives a
// broad solid body to sample, well clear of the cyan radiator fins at the edges.

import {
  newGame,
  arrangeNearRedline,
  actUntilTripped,
  actSampleTowerBody,
} from "../_helpers.mjs";

export default function item() {
  let id;
  let hit;
  let body;

  return {
    id: "trip.strobing-red",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      const c = await arrangeNearRedline(api, "lance", { heat: 92 });
      id = c.id;
    },

    // Trip it for real, then read the pixels it paints while offline. The sample
    // helper settles for a frame first — an instant advance paints nothing, so
    // without that the read would race the renderer.
    async act(api) {
      const r = await actUntilTripped(api, id);
      hit = r.hit;
      body = await actSampleTowerBody(api, id);
      await api.screenshot("strobe");
    },

    async assert(api, check) {
      check.expectOk("the emitter tripped", hit);
      check.expectGt(
        "a tripped tower's red channel dominates green",
        body.r,
        body.g + 30,
      );
      check.expectGt(
        "a tripped tower's red channel dominates blue",
        body.r,
        body.b + 30,
      );
    },
  };
}
