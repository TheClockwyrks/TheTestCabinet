// Automated validation for hazards.gas-scales-depth.
//
// A gas detonation deep in the coreshell deals far more hull damage than one in the shallow
// rockbed. We detonate a gas pocket at each depth with a high hull (so both are survivable and the
// full damage registers) and the same tier-1 radiator, and compare the hull dropped.

import {
  teleportInto,
  K,
  newRun,
  standAt,
  SPAWN_COL,
  ROCKBED_ROW,
  CORESHELL_ROW,
} from "../_helpers.mjs";

/**
 * ACT: detonate a freshly-posed gas pocket at the given row and return the hull lost.
 *
 * Everything it poses is a control op, so the second detonation re-poses the scenario at a new
 * depth without the reset the runtime forbids inside `act`.
 */
async function actGasHullLoss(api, col, row) {
  await standAt(api, col, row);
  await api.call("setTile", col, row + 1, { kind: "gas" });
  await api.call("setTile", col, row + 2, { kind: "rock" });
  await teleportInto(api, col, row);
  await api.call("grantGear", { hull: 5 }); // top hull track; radiator stays tier 1 (no cut)
  // Fill the hull EXPLICITLY rather than trusting the tier grant to have left it full.
  //
  // `grantGear` raises the maxima, and `specs/upgrades.md` has a hull upgrade add its capacity
  // increase to the CURRENT hull (`40/100` becomes `90/150`) — not repair to full. That top-up
  // only happens on a tier that actually changes, so the second call below, on a miner already at
  // tier 5, adds nothing: whatever the first detonation took stays taken. The deep pocket then
  // fires into a part-empty hull, and if it kills the miner outright the sweep reads a dead run
  // rather than a damage number. `setHull` is clamped to the current maximum
  // (`specs/instrumentation.md`), so an over-large value is exactly "fill it", and the item then
  // measures only what it claims to — how hard gas hits at each depth.
  await api.call("setHull", 100000);
  const hull0 = (await api.snapshot()).miner.hull;
  await api.advance(30); // 30 ticks = 0.5 s with the pocket intact and the hull full
  await api.call("keyDown", K.down);
  // The cap is deliberately far past the cut this needs.
  //
  // `specs/upgrades.md` puts a coreshell tile at `16` hp and a tier-1 drill at `2.00 s`, and the
  // old cap was 3 s — 50% headroom, which sounds ample and is not. A build whose drill runs slower
  // than the table simply never breaks the tile inside the window, and the sweep then reports a
  // hull loss of ZERO: this item fails, and its failure reads as "deep gas is harmless" when what
  // actually went wrong is the drill rate. That deviation has its own item (`fuel.drill-cost`) and
  // belongs to it. 600 ticks = 10 s leaves the verdict here decided by how hard the gas hits and
  // nothing else. It costs nothing: the validate pass steps instantly, and the record pass stops at
  // its clip budget regardless.
  // poll 3 = the old 0.05 s chunk, fine enough that the hull is read at the detonation rather than
  // after further drilling.
  const r = await api.until((s) => s.miner.hull < hull0, { max: 600, poll: 3 });
  await api.call("keyUp", K.down);
  await api.advance(75); // 75 ticks = 1.25 s of blast and the hull bar settling at its new level
  return hull0 - r.snap.miner.hull;
}

export default function item() {
  const col = SPAWN_COL;
  let shallow;
  let deep;

  return {
    id: "hazards.gas-scales-depth",

    async arrange(api) {
      await newRun(api);
    },

    // Both detonations are timed, so both run here — and the clip shows the shallow pocket against
    // the deep one, which is the comparison being asserted.
    async act(api) {
      shallow = await actGasHullLoss(api, col, ROCKBED_ROW);
      deep = await actGasHullLoss(api, col, CORESHELL_ROW);
    },

    async assert(api, check) {
      check.expectGt("a shallow gas pocket costs hull", shallow, 5);
      check.expectGt("a deep gas pocket costs far more", deep, 40);
      check.expectGt("gas damage scales with depth", deep, shallow * 1.8);
    },
  };
}
