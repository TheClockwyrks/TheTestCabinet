// Automated validation for the Hunter item `safe-bays`.
//
// The bear never enters the far-shore wall or a bay, so a critter safe in a filled
// bay is permanently safe from it. The critter is placed in a filled bay (row 1)
// and a bear set below it on cleared water; over many steps the real pursuit never
// reaches row 1 and never catches the critter. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The shallowest row the bear ever reached, and the state at the end of the watch.
  let minRow;
  let final;

  return {
    id: "hunter.safe-bays",

    // Pose the critter safe in a filled bay with the bear right below it on cleared
    // open water — nothing between them but the far-shore wall, so the only thing
    // keeping the bear out is the rule under test.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("setBays", [true, false, false, false, false]);
      for (const r of [2, 3]) await api.call("setLane", r, { cols: [] }); // open water below the bay
      await api.call("placeCritter", 3, 1); // safe in the filled bay
      await api.call("setBear", 0, { col: 3, row: 3 });
    },

    // Two seconds of the real pursuit pressing against the far shore, sampled every
    // 0.05 s so a momentary incursion into row 1 could not slip between reads. The
    // bear straining at the shore and never getting in is also the clip.
    async act(api) {
      minRow = 99;
      for (let k = 0; k < 40; k += 1) {
        await api.advance(6); // 0.05 s
        const s = await api.snapshot();
        if (s.bears[0].present) minRow = Math.min(minRow, s.bears[0].row);
      }
      final = await api.snapshot();
    },

    async assert(api, check) {
      check.expectGe(
        "the bear never enters the far-shore wall / a bay (row < 2)",
        minRow,
        2,
      );
      check.expectNe(
        "the critter in the filled bay is never caught",
        final.phase,
        "dying",
      );
      check.expectEq("the critter kept all lives", final.lives, 3);
    },
  };
}
