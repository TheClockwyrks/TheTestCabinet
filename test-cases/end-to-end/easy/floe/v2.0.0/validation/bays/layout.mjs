// Automated validation for the Bays item `layout`.
//
// There are five bays, each enterable at its own far-shore column, with solid
// shore between them that cannot be entered. Each bay is confirmed by a real hop
// up from a floe below its column filling that bay; a solid-shore column refuses
// the same hop. See validation/_helpers.mjs.

import { startCrossing, BAY_LEFT, WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // Whether each bay filled, and the critter's row after the solid-shore hop.
  let filled;
  let shoreRow;

  return {
    id: "bays.layout",

    // One fresh crossing is all `arrange` needs. Every bay in turn is re-posed inside
    // `act` with control ops alone (`setBays` / `setLane` / `placeCritter`), which set
    // the board without the reset `startCrossing` performs — a reset in `act` would
    // hand the build back its manual clock and silently freeze the recording.
    async arrange(api) {
      await startCrossing(api);
    },

    // Walk the five bay columns, hopping up into each from a floe below it, then the
    // solid shore between two of them. Each pose is instant, so only the hops consume
    // time and the clip is the five fills and the one refusal back to back.
    async act(api) {
      filled = [];
      for (let i = 0; i < BAY_LEFT.length; i += 1) {
        const col = BAY_LEFT[i];
        await api.call("setBays", [false, false, false, false, false]);
        await api.call("setLane", WATER_TOP, { cols: [col], speed: 0 });
        await api.call("placeCritter", col, WATER_TOP);
        await api.call("press", "ArrowUp");
        await api.advance(18); // 0.15 s, just past the hop cooldown
        filled.push((await api.snapshot()).bays[i]);

        // Filling a bay drops the game into its brief post-fill settle, and a hop
        // is refused until the next crossing begins. Wait that out before posing
        // the next column — otherwise every following press is swallowed and the
        // bay it aims at reads unenterable when it is merely mistimed.
        await api.until((s) => s.phase === "crossing", { max: 120, poll: 6 });
      }

      // A solid-shore column between bays refuses the hop.
      await api.call("setLane", WATER_TOP, { cols: [8], speed: 0 });
      await api.call("placeCritter", 8, WATER_TOP);
      await api.call("press", "ArrowUp");
      await api.advance(18);
      shoreRow = (await api.snapshot()).critter.row;

      // Image: the far shore with its five bays, reopened so the still shows the
      // layout rather than the fills the loop just drove.
      await api.call("setBays", [false, false, false, false, false]);
      await api.advance(18); // 0.15 s, so the reopened shore has drawn
      await api.screenshot("scene");
    },

    async assert(api, check) {
      for (let i = 0; i < BAY_LEFT.length; i += 1) {
        check.expectEq(
          `bay ${i} is enterable at column ${BAY_LEFT[i]}`,
          filled[i],
          true,
        );
      }
      check.expectEq(
        "the solid shore between bays cannot be entered",
        shoreRow,
        WATER_TOP,
      );
    },
  };
}
