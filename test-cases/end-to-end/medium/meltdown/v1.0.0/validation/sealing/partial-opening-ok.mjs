// Automated validation for the Sealing sub-item `partial-opening-ok`.
//
// A tower may partially cover a vent or exhaust opening — only fully sealing it is
// forbidden (specs/reactor.md). The left vent spans rows 16-19; a 2x2 tower at
// (0,16) covers rows 16-17 but leaves 18-19 open, so it is a valid placement.

import { newGame, build, tower } from "../_helpers.mjs";

export default function item() {
  let can;
  let placed;
  let routed;

  return {
    id: "sealing.partial-opening-ok",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // Ask the validator, then actually build the partial cover and confirm a route
    // still exists past it. Letting a frame land shows the half-covered vent.
    async act(api) {
      can = await api.call("canPlace", "arc", 0, 16, 0);
      const id = await build(api, "arc", 0, 16);
      placed = (await tower(api, id)) !== null;
      routed = isFinite((await api.snapshot()).paths.left.length);
      await api.settle(80);
      await api.screenshot("partial");
    },

    async assert(api, check) {
      check.expectEq(
        "partly covering the vent (rows 16-17) is a valid placement",
        can,
        true,
      );
      check.expectOk("the partial-cover tower was built", placed);
      check.expectOk(
        "a route still exists past the partly-covered vent",
        routed,
      );
    },
  };
}
