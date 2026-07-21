// Automated validation for the Water band item `floe-mix`.
//
// Floes are a mix of 1-tile pans and solid 3-tile and 4-tile rafts (each raft one
// continuous piece, not tiled pans). Read straight from the snapshot: the kinds
// present and their native lengths. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The floe kinds and their lengths — settled the moment the level is built, so the
  // read is instant and belongs in `arrange`.
  let byKind;

  return {
    id: "water.floe-mix",

    async arrange(api) {
      await startCrossing(api);
      const items = (await api.snapshot()).lanes.water.flatMap((l) => l.items);
      byKind = {};
      for (const f of items) byKind[f.kind] = f.len;
    },

    // Nothing has to happen for the check; the clip's job is to show the mix of floes
    // the assertions describe, so let it draw and capture it.
    async act(api) {
      // 0.12 s is 14.4 ticks, which the tick contract rejects rather than rounds. This
      // is a paint settle, so it rounds UP to 15 — never shorter than it was.
      await api.advance(15);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectOk("single-tile pans are present", byKind.pan !== undefined);
      check.expectOk("3-tile rafts are present", byKind.raft3 !== undefined);
      check.expectOk("4-tile rafts are present", byKind.raft4 !== undefined);
      check.expectEq("a pan is one tile", byKind.pan, 1);
      check.expectEq("a raft3 is a solid 3 tiles", byKind.raft3, 3);
      check.expectEq("a raft4 is a solid 4 tiles", byKind.raft4, 4);
    },
  };
}
