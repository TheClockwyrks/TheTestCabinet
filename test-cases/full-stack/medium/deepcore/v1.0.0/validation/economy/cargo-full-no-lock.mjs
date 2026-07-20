// Automated validation for economy.cargo-full-no-lock.
//
// Drilling an ore tile with the bay full by slots still clears the tile to tunnel; the ore is left
// behind rather than hard-locking the miner behind an undrillable tile. We fill the bay to capacity,
// drill an ore tile, and confirm it cleared while the slot count did not rise.

import { K, newRun, SPAWN_COL, TOPSOIL_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.cargo-full-no-lock");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  const cap = (await api.snapshot()).cargo.slotCap;
  await api.call("addCargo", "ferron", cap); // fill the bay by slots
  check.expectEq("the bay is full", (await api.snapshot()).cargo.slotsUsed, cap);

  await api.call("teleport", col, row);
  await api.call("setTile", col, row + 1, { kind: "ore", ore: "marlite" });
  await api.call("setTile", col, row + 2, { kind: "rock" });
  await api.call("teleport", col, row);

  await api.call("keyDown", K.down);
  await api.step(1.0); // run the real cut to completion (a topsoil tile breaks in ~0.5s)
  const cleared = await api.call("tileAt", col, row + 1);
  await api.call("keyUp", K.down);
  const snap = await api.snapshot();

  check.expectEq("the full-bay ore tile still clears to tunnel", cleared ? cleared.kind : null, "tunnel");
  check.expectEq("the slot count did not rise past capacity", snap.cargo.slotsUsed, cap);
  check.expectOk("the marlite was left behind, not collected", !snap.cargo.ore.marlite);

  await liveClip(api, 600);
  return check.verdict();
}
