// Automated validation for rocket.blast-immune.
//
// The three deep rocket parts are gated on world objects the player must reach: the two exotic
// material nodes (Resonite, Cryenite) and the Core. If an explosive could destroy any of them the
// player could accidentally lock themselves out of the win, so all three are immune to explosives
// (specs/rocket.md, specs/items.md). We ring the miner with a Resonite node, a Cryenite node, the
// Core, and a control rock tile, set off the largest blast (Plastic Explosives, a 5×5), and confirm
// the three win nodes are untouched while the control rock is cleared — proving the blast really
// fired and the immunity is real, not the blast missing them.

import { newRun, DEEPSTONE_ROW, SPAWN_COL } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;
  const placed = {};
  let control;
  let resTile;
  let cryTile;
  let coreTile;

  return {
    id: "rocket.blast-immune",

    // Centre the miner (teleport carves its own cell to tunnel and recenters the camera), then ring
    // it with the win-required nodes and one ordinary rock, all inside the 5×5 Plastic blast radius.
    async arrange(api) {
      await newRun(api);
      await api.call("teleport", col, row);
      await api.call("setTile", col - 1, row, {
        kind: "material",
        material: "resonite",
      });
      await api.call("setTile", col + 1, row, {
        kind: "material",
        material: "cryenite",
      });
      await api.call("setTile", col, row - 1, { kind: "core" });
      await api.call("setTile", col, row + 1, { kind: "rock" }); // control: an ordinary tile the blast clears

      // Precondition: the four tiles are arranged as intended before the blast.
      placed.resonite = (await api.call("tileAt", col - 1, row)).material;
      placed.cryenite = (await api.call("tileAt", col + 1, row)).material;
      placed.core = (await api.call("tileAt", col, row - 1)).kind;
      placed.control = (await api.call("tileAt", col, row + 1)).kind;
    },

    // The blast IS the behavior under test, so it goes off here and the clip shows it fire and the
    // nodes stand through it.
    async act(api) {
      // Set off the largest explosive, centered on the miner, through the real buy/use path.
      await api.call("grantCredits", 5000);
      await api.call("buyItem", "plastic-explosives");
      await api.call("useItem", "plastic-explosives");

      control = (await api.call("tileAt", col, row + 1)).kind;
      resTile = await api.call("tileAt", col - 1, row);
      cryTile = await api.call("tileAt", col + 1, row);
      coreTile = (await api.call("tileAt", col, row - 1)).kind;

      await api.advance(42); // 42 ticks = 0.7 s, the old 700 ms clip tail
    },

    async assert(api, check) {
      check.expectEq("Resonite node is placed", placed.resonite, "resonite");
      check.expectEq("Cryenite node is placed", placed.cryenite, "cryenite");
      check.expectEq("the Core is placed", placed.core, "core");
      check.expectEq("the control rock is placed", placed.control, "rock");

      // The blast really fired: the ordinary rock in range is cleared to open tunnel.
      check.expectEq(
        "the control rock is cleared by the blast",
        control,
        "tunnel",
      );

      // The three win-required nodes are untouched.
      check.expectEq(
        "the Resonite node survives the blast (still a material tile)",
        resTile.kind,
        "material",
      );
      check.expectEq(
        "the Resonite is still Resonite",
        resTile.material,
        "resonite",
      );
      check.expectEq(
        "the Cryenite node survives the blast (still a material tile)",
        cryTile.kind,
        "material",
      );
      check.expectEq(
        "the Cryenite is still Cryenite",
        cryTile.material,
        "cryenite",
      );
      check.expectEq("the Core survives the blast", coreTile, "core");
    },
  };
}
