// Automated validation for the Economy sub-item `bounty`.
//
// Killing a unit pays its kill bounty (specs/economy.md — a Mote pays 3). From zero
// money we kill a single real Mote with an Arc and confirm exactly its bounty lands.

import { newGame, build, spawn, TICK } from "../_helpers.mjs";

export default function item() {
  let r;
  let money;

  return {
    id: "economy.bounty",

    // One Arc, hot enough to kill, one Mote, and a zeroed balance — so whatever money
    // appears IS the bounty, with nothing else able to contribute.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const id = await build(api, "arc", 3, 20);
      await api.call("setHeat", id, 80);
      await api.call("setMoney", 0);
      await spawn(api, "mote", "left");
    },

    // 360 ticks = the old 6s cap; polling every tick reads the balance at the kill
    // rather than after anything else could have paid out.
    async act(api) {
      r = await api.until((s) => s.money > 0, { max: 360, poll: TICK });
      money = (await api.snapshot()).money;
    },

    async assert(api, check) {
      check.expectOk("killing the Mote paid out", r.hit);
      check.expectEq("a Mote kill pays exactly its bounty (3)", money, 3);
    },
  };
}
