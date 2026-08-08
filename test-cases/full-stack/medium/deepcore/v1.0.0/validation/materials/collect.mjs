// Automated validation for materials.collect.
//
// Drilling a material node collects the exotic material into the satchel. We place a Resonite node
// below the miner, drill it, and read the satchel back.

import {
  teleportInto,
  K,
  newRun,
  SPAWN_COL,
  ROCKBED_ROW,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let start;
  let r;
  let cleared;

  return {
    id: "materials.collect",

    // An empty satchel, standing over a Resonite node with rock beneath it.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await api.call("setTile", col, row + 1, {
        kind: "material",
        material: "resonite",
      });
      await api.call("setTile", col, row + 2, { kind: "rock" });
      await teleportInto(api, col, row);
      start = (await api.snapshot()).satchel.resonite;
    },

    // Drill until the material lands in the satchel — the collection is what is checked and shown.
    //
    // The sweep stops on the very tick the node is banked, which is the right instant to READ but
    // the wrong frame to end a clip on: the satchel readout changes and the film cuts, so the
    // pickup is over before it is visible. A beat on either side puts the intact node on screen
    // first and holds the banked satchel and the cleared tunnel after.
    async act(api) {
      await api.advance(30); // 30 ticks = 0.5 s with the node intact and the satchel empty
      await api.call("keyDown", K.down);
      // 600 ticks = 10 s, far past the cut this needs: a build whose drill runs slower than the
      // table in `specs/upgrades.md` should fail `fuel.drill-cost`, not report here that a material
      // node cannot be collected. poll 3 = the old 0.05 s chunk, fine enough to read the satchel at
      // the instant the node is banked.
      r = await api.until((s) => s.satchel.resonite > 0, { max: 600, poll: 3 });
      await api.call("keyUp", K.down);
      cleared = await api.call("tileAt", col, row + 1);
      await api.advance(90); // 90 ticks = 1.5 s on the banked material and the cleared cell
    },

    async assert(api, check) {
      check.expectEq("the satchel starts without Resonite", start, 0);
      check.expectEq(
        "drilling the node banks the Resonite",
        r.snap.satchel.resonite,
        1,
      );
      check.expectEq(
        "the node tile clears to tunnel",
        cleared ? cleared.kind : null,
        "tunnel",
      );
    },
  };
}
