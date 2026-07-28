// Automated validation for the UI item `state-victory`: the victory screen is
// reachable, and the debug API captures it. Level 8 is cleared through the real
// flow (fill the fifth bay) and the victory screen read back and captured.
//
// The screen is WAITED FOR rather than sampled a fixed moment after the hop: nothing
// in specs/gameplay.md or specs/ui.md pins how soon the Victory screen follows the
// winning bay, so a build that runs a clearing flourish first is conformant and a
// short fixed wait would score it as never reaching the screen at all. See
// `validation/progression/victory.mjs`, which decides the same fact.

import { WATER_TOP } from "../_helpers.mjs";

// How long a build may spend between the winning hop and the Victory screen, and how
// long the screen is then left to draw before it is captured.
const WIN_TICKS = 600; // 5 s
const DRAW_TICKS = 18; // 0.15 s

export default function item() {
  // The screen after the clearing hop.
  let screen;

  return {
    id: "ui.state-victory",

    // Pose the final level one bay short of done: level 8, four bays filled, and the
    // critter on a floe below the fifth.
    async arrange(api) {
      await api.reset();
      await api.call("setLevel", 8);
      await api.call("setBays", [true, true, true, true, false]);
      await api.call("setLane", WATER_TOP, { cols: [35], speed: 0 });
      await api.call("placeCritter", 35, WATER_TOP);
    },

    // The hop that wins the game, then a moment for the victory screen to draw before
    // capturing it.
    async act(api) {
      await api.call("press", "ArrowUp");
      screen = (
        await api.until((s) => s.screen === "victory", {
          max: WIN_TICKS,
          poll: 6,
        })
      ).snap.screen;
      await api.advance(DRAW_TICKS); // so the victory screen has drawn
      await api.screenshot("victory");
    },

    async assert(api, check) {
      check.expectEq(
        "clearing level 8 reaches the victory screen",
        screen,
        "victory",
      );
    },
  };
}
