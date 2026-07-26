// Automated validation for controls.stamp-b: pressing B during a build phase pulls the
// scrap-press, arming a blank rock on the cursor; it can then be placed.
//
// Only opening the run is arranged. Pulling the press and dropping the armed rock is the
// behavior under test, and key presses and clicks are control ops, so the whole sequence is the
// act — the clip shows the press pull and the drop, which is exactly what is asserted.

import { startBuild, snap, spawnControlled, SECOND } from "../_helpers.mjs";

// A moment after the drop, with a Spark walking, so the landed rock reads on a live board.
const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The board after the press and after the drop, read by `assert`.
  let s1;
  let s2;

  return {
    id: "controls.stamp-b",

    async arrange(api) {
      await startBuild(api);
    },

    async act(api) {
      await api.call("press", "KeyB");
      s1 = await snap(api);

      // The armed rock can then be placed with a click on a legal footprint.
      await api.call("pointerMove", 120, 260);
      await api.call("click", 120, 260);
      s2 = await snap(api);

      await spawnControlled(api, "spark");
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectOk("pressing B armed a rock (the press pulled)", !!s1.held && s1.held.active);
      check.expectGt("the armed rock is then placeable", s2.towers.filter((t) => t.kind === "candidate").length, 0);
    },
  };
}
