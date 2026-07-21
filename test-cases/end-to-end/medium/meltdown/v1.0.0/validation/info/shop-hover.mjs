// Automated validation for the Info sub-item `shop-hover`.
//
// Hovering a shop tower shows that type's info panel in the inspector area
// (specs/reactor.md). We set the hovered shop tower through the debug API and read
// the hovered-shop state back, capturing the panel for the reviewer to read.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let s;

  return {
    id: "info.shop-hover",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // Hover the Lance and let a frame land so the captured still actually shows the
    // info panel the hover opens.
    async act(api) {
      await api.call("hoverShop", "lance");
      s = await api.snapshot();
      await api.settle(80);
      await api.screenshot("hover");
    },

    async assert(api, check) {
      check.expectEq(
        "hovering the Lance shows its info panel",
        s.hoverShop,
        "lance",
      );
    },
  };
}
