// Automated validation for economy.cargo-full-no-lock.
//
// Drilling an ore tile with the bay full by slots still clears the tile to tunnel; the ore is left
// behind rather than hard-locking the miner behind an undrillable tile. We fill the bay to capacity,
// drill an ore tile, and confirm it cleared while the slot count did not rise.

import { K, newRun, SPAWN_COL, TOPSOIL_ROW } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let cap;
  let full;
  let cleared;
  let snap;

  return {
    id: "economy.cargo-full-no-lock",

    // A bay filled to its slot capacity, standing over a marlite ore tile with rock beneath it.
    async arrange(api) {
      await newRun(api);
      cap = (await api.snapshot()).cargo.slotCap;
      await api.call("addCargo", "ferron", cap); // fill the bay by slots
      full = (await api.snapshot()).cargo.slotsUsed;

      await api.call("teleport", col, row);
      await api.call("setTile", col, row + 1, { kind: "ore", ore: "marlite" });
      await api.call("setTile", col, row + 2, { kind: "rock" });
      await api.call("teleport", col, row);
    },

    // The cut is the behavior and the clip: the tile must break even though there is nowhere to
    // put what comes out of it.
    async act(api) {
      await api.call("keyDown", K.down);
      await api.advance(60); // 60 ticks = 1 s: the real cut to completion (topsoil breaks in ~0.5 s)
      cleared = await api.call("tileAt", col, row + 1);
      await api.call("keyUp", K.down);
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("the bay is full", full, cap);
      check.expectEq(
        "the full-bay ore tile still clears to tunnel",
        cleared ? cleared.kind : null,
        "tunnel",
      );
      check.expectEq(
        "the slot count did not rise past capacity",
        snap.cargo.slotsUsed,
        cap,
      );
      check.expectOk(
        "the marlite was left behind, not collected",
        !snap.cargo.ore.marlite,
      );
    },
  };
}
