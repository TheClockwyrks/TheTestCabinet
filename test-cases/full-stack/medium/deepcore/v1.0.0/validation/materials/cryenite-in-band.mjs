// Automated validation for materials.cryenite-in-band.
//
// Every mine contains a buried Cryenite node in the Deepstone band (guaranteed). We enumerate both
// guaranteed nodes, confirm one is Cryenite in the deepstone, then (on the same seed) reach it and
// capture it.

import { teleportInto, bothNodes } from "../_helpers.mjs";

export default function item() {
  let cry;

  return {
    id: "materials.cryenite-in-band",

    // Enumerating the nodes consumes no time, and it resets on the way — so it belongs here, not in
    // `act` where a reset is forbidden. The mine is then regenerated on the SAME seed so the node's
    // tile is intact again (the enumeration carves the first node away to find the second), and the
    // miner is put two tiles above it with the node in view below.
    async arrange(api) {
      const nodes = await bothNodes(api, 1);
      cry = nodes.find((n) => n.material === "cryenite");
      if (cry) {
        await api.reset({ seed: 1 });
        await api.call("startExpedition", "standard", "standard");
        await teleportInto(api, cry.col, cry.row - 2);
      }
    },

    // The capture is the point, so it happens here behind a real settle — the validate pass paints
    // no frame of its own and the node has to be on the canvas.
    async act(api) {
      await api.settle(150);
      await api.screenshot("node");
    },

    async assert(api, check) {
      check.expectOk("a Cryenite node exists in the mine", !!cry);
      check.expectEq(
        "the Cryenite node is in the deepstone band",
        cry ? cry.band : null,
        "deepstone",
      );
    },
  };
}
