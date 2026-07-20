// Automated validation for materials.resonite-in-band.
//
// Every mine contains a buried Resonite node in the Rockbed band (guaranteed, so a run can never
// be soft-locked by an unlucky map). We enumerate both guaranteed nodes, confirm one is Resonite
// in the rockbed, then (on the same seed) reach it and capture it.

import { bothNodes } from "../_helpers.mjs";

export default function item() {
  let res;

  return {
    id: "materials.resonite-in-band",

    // Enumerating the nodes consumes no time, and it resets on the way — so it belongs here, not in
    // `act` where a reset is forbidden. Reach it on the same seed (its tile is intact this pass).
    async arrange(api) {
      const nodes = await bothNodes(api, 1);
      res = nodes.find((n) => n.material === "resonite");
      if (res) {
        await api.reset({ seed: 1 });
        await api.call("startExpedition", "standard", "standard");
        await api.call("teleport", res.col, res.row - 2); // two tiles above, node in view below
      }
    },

    // The capture is the point, so it happens here behind a real settle — the validate pass paints
    // no frame of its own and the node has to be on the canvas.
    async act(api) {
      await api.settle(150);
      await api.screenshot("node");
    },

    async assert(api, check) {
      check.expectOk("a Resonite node exists in the mine", !!res);
      check.expectEq(
        "the Resonite node is in the rockbed band",
        res ? res.band : null,
        "rockbed",
      );
    },
  };
}
