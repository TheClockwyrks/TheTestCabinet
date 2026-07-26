// Automated validation for the Progression item `lives`.
//
// A new run starts with three lives. Read straight from the snapshot after a fresh
// start, and capture the opening HUD. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The starting life count — settled the moment the run begins, so the read is
  // instant and belongs in `arrange`.
  let lives;

  return {
    id: "progression.lives",

    async arrange(api) {
      await startCrossing(api);
      lives = (await api.snapshot()).lives;
    },

    // Nothing has to happen for the check; the clip's job is to show the opening HUD
    // the assertion describes, so let it draw and capture it.
    async act(api) {
      await api.advance(18); // 0.15 s, so the opening HUD has drawn
      await api.screenshot("start");
    },

    async assert(api, check) {
      check.expectEq("a new run starts with three lives", lives, 3);
    },
  };
}
