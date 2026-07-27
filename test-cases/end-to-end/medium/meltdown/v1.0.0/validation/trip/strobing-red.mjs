// Automated validation for the Trip sub-item `strobing-red`.
//
// While offline a tripped tower is drawn strobing red (specs/heat.md), so a gapped
// kill-box reads at a glance. The check trips a real emitter, then samples the
// pixels it actually RENDERS on its body — red must dominate both other channels
// (both strobe frames are red). Reading the rendered pixel means a build cannot pass
// by a color it does not draw. A Lance is used because its large footprint gives the
// sampler plenty of the tower to read.
//
// The footprint is sampled twice, still online and then tripped, and paired through
// `glowBetween`: what a build repaints when a tower trips is what "a tripped tower is
// unmistakable" means, and pairing finds it wherever the build draws it instead of
// betting on a solid body fill. It also makes the null case meaningful — a tower that
// paints identically online and offline has not been made unmistakable at all.

import {
  newGame,
  arrangeNearRedline,
  actUntilTripped,
  actSampleTower,
  glowBetween,
} from "../_helpers.mjs";

export default function item() {
  let id;
  let hit;
  let strobe;

  return {
    id: "trip.strobing-red",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      const c = await arrangeNearRedline(api, "lance", { heat: 92 });
      id = c.id;
    },

    // Read the tower online, trip it for real, then read it again while offline. The
    // sample helper settles for a frame first — an instant advance paints nothing, so
    // without that the read would race the renderer. The settle consumes no
    // simulation time in the validate pass, so the online read cannot itself carry
    // the tower over the redline.
    async act(api) {
      const online = await actSampleTower(api, id);

      const r = await actUntilTripped(api, id);
      hit = r.hit;

      const tripped = await actSampleTower(api, id);
      strobe = glowBetween(online, tripped);
      await api.screenshot("strobe");
    },

    async assert(api, check) {
      check.expectOk("the emitter tripped", hit);
      // Hard: a null result means the footprint paints the same online and tripped,
      // and the channel assertions below would read off null.
      check.assertOk(
        "a tripped tower repaints, rather than looking as it did online",
        strobe !== null,
      );
      check.expectGt(
        "a tripped tower's red channel dominates green",
        strobe.after.r,
        strobe.after.g + 30,
      );
      check.expectGt(
        "a tripped tower's red channel dominates blue",
        strobe.after.r,
        strobe.after.b + 30,
      );
    },
  };
}
