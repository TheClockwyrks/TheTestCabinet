// Shift: every level begins with exactly three lives.

import { startFresh } from "../_helpers.mjs";

export default function item() {
  // The starting life count on each of the two levels checked.
  let livesLevel1;
  let livesLevel4;

  return {
    id: "shift.three-lives",

    // Enter level 1 and read its starting lives — a pure snapshot read, so it costs no time.
    async arrange(api) {
      await startFresh(api, 1);
      livesLevel1 = (await api.snapshot()).level.lives;
    },

    // Capture level 1's HUD, then jump to a later level and read its lives too.
    // `startLevel` is a control op — no clock involvement — so it is legal mid-act.
    async act(api) {
      await api.settle(150); // let the HUD paint before capturing it
      await api.screenshot("hud");

      await api.call("startLevel", 4);
      livesLevel4 = (await api.snapshot()).level.lives;

      // A moment of level 4 running, so the clip shows its HUD too rather than cutting
      // the instant the level loads.
      await api.advance(30);
    },

    async assert(api, check) {
      check.expectEq("level 1 starts with three lives", livesLevel1, 3);
      check.expectEq("level 4 also starts with three lives", livesLevel4, 3);
    },
  };
}
