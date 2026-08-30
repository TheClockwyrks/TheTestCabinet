// Automated validation for hazards.gas-detonates.
//
// Drilling into a gas pocket detonates it, dealing hull damage and knocking the miner back. We set
// a gas tile below the miner, drill it, and read the hull drop and the cleared tile back.

import {
  teleportInto,
  K,
  newRun,
  standAt,
  SPAWN_COL,
  ROCKBED_ROW,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let hull0;
  let r;
  let cleared;

  return {
    id: "hazards.gas-detonates",

    // A grounded miner standing over a gas pocket, hulled up enough to survive the blast.
    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row);
      await api.call("setTile", col, row + 1, { kind: "gas" });
      await api.call("setTile", col, row + 2, { kind: "rock" });
      await teleportInto(api, col, row);
      await api.call("grantGear", { hull: 3 }); // survive the deadly rockbed gas so the knockback reads
      // Fill the hull explicitly. `specs/hazards.md` puts the raw rockbed hit at `~60` and rising,
      // so a build that raises the ceiling without granting the capacity leaves the miner on
      // `100/220` and the blast can kill it outright — the hull still drops, so this item's
      // assertions survive, but the miner it was posed to knock back is dead and the clip shows a
      // Game Over screen instead of the shove. The grant contract has its own item,
      // `economy.grant-applies-tiers`.
      await api.call("setHull", 100000);
      hull0 = (await api.snapshot()).miner.hull;
    },

    // The cut into the pocket and the detonation it triggers are the behavior, and the clip.
    //
    // The sweep stops on the first tick the hull drops — the detonation's opening frame — so on its
    // own it films the cut and then cuts away exactly as the blast begins. The knock-back, the
    // cleared tile, and the dented hull bar all land AFTER that instant, so the tail below is what
    // actually shows the detonation; the lead-in gives it the intact pocket to blow up.
    async act(api) {
      await api.advance(30); // 30 ticks = 0.5 s with the pocket intact and the hull full
      await api.call("keyDown", K.down);
      // 600 ticks = 10 s, far past the cut this needs: a build whose drill runs slower than the
      // table in `specs/upgrades.md` should fail `fuel.drill-cost`, not report here that drilling a
      // gas pocket does nothing. poll 3 = the old 0.05 s chunk, fine enough to catch the detonation
      // instant rather than a later moment of drilling.
      r = await api.until((s) => s.miner.hull < hull0, { max: 600, poll: 3 });
      await api.call("keyUp", K.down);
      cleared = await api.call("tileAt", col, row + 1);
      await api.advance(120); // 120 ticks = 2 s of blast, knock-back, and the cleared tunnel
    },

    async assert(api, check) {
      check.expectLt("the detonation costs hull", r.snap.miner.hull, hull0);
      check.expectEq(
        "the gas tile clears to tunnel",
        cleared ? cleared.kind : null,
        "tunnel",
      );
    },
  };
}
