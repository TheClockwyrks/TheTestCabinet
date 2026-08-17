// Automated validation for the UI item `state-victory`: the victory screen is
// reachable, and the debug API captures it. Level 8 is cleared through the real
// flow (fill the fifth bay) and the victory screen read back and captured.
//
// The screen is WAITED FOR rather than sampled a fixed moment after the hop: nothing
// in specs/gameplay.md or specs/ui.md pins how soon the Victory screen follows the
// winning bay, so a build that runs a clearing flourish first is conformant and a
// short fixed wait would score it as never reaching the screen at all. See
// `validation/progression/victory.mjs`, which decides the same fact.

import { arrangeLevel, BAY_COL, WATER_TOP } from "../_helpers.mjs";

// The last bay, entered at the column its opening straddles under either reading
// of specs/playfield.md's bay layout (see `BAY_COL`).
const COL = BAY_COL[4];

// How long a build may spend between the winning hop and the Victory screen, and how
// long the screen is then left to draw before it is captured.
const WIN_TICKS = 600; // 5 s
const DRAW_TICKS = 18; // 0.15 s

export default function item() {
  // Whether posing the final level started a crossing, and the screen after the
  // clearing hop.
  let posed;
  let screen;

  return {
    id: "ui.state-victory",

    // Pose the final level one bay short of done: level 8, four bays filled, and the
    // critter on a floe below the fifth.
    async arrange(api) {
      posed = await arrangeLevel(api, 8);
      await api.call("setBays", [true, true, true, true, false]);
      await api.call("setLane", WATER_TOP, { cols: [COL], speed: 0 });
      await api.call("placeCritter", COL, WATER_TOP);
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
      check.expectOk(
        "posing the level begins a fresh crossing on it, rather than leaving the run on a menu",
        posed.began,
      );
      check.expectEq(
        "clearing level 8 reaches the victory screen",
        screen,
        "victory",
      );
    },
  };
}
