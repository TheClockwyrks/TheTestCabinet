// Automated validation for the Progression item `victory`.
//
// Clearing the eighth level wins the game (the victory screen appears). The level
// is set to 8 with four bays filled; a real hop fills the fifth, and the real
// flow reaches victory, which the snapshot reads back and a screenshot captures.
// See validation/_helpers.mjs.
//
// THE WIN IS WAITED FOR, NOT SAMPLED. specs/gameplay.md says clearing level 8 wins
// and specs/ui.md says the Victory screen is shown when it does; neither says how
// soon, and a build that plays a clearing flourish before handing over to the
// screen has broken no rule. Reading the screen a fifth of a second after the hop
// scores that build as never having won at all — it fails the point most
// emphatically the moment it does something the spec left to it. So the sweep waits
// as long as such a pause could reasonably run, which is the same generosity
// `validation/audio/level-clear.mjs` already extends to a between-levels pause.

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
    id: "progression.victory",

    // Pose the final level one bay short of done: level 8, four bays filled, and the
    // critter on a floe below the fifth.
    async arrange(api) {
      posed = await arrangeLevel(api, 8);
      await api.call("setBays", [true, true, true, true, false]);
      await api.call("setLane", WATER_TOP, { cols: [COL], speed: 0 });
      await api.call("placeCritter", COL, WATER_TOP);
    },

    // The hop that wins the game — what is checked, and what the capture shows.
    async act(api) {
      await api.call("press", "ArrowUp"); // fill the fifth bay at level 8 -> victory
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
      check.expectEq("clearing level 8 wins the game", screen, "victory");
    },
  };
}
