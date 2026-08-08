// Automated validation for the Economy sub-item `damage-pays`.
//
// Energy is earned by damage dealt, not by kills: stripping a shell pays 1, so a shot that
// strips two shells pays 2. Damage past a unit's last shell pays nothing, so a hard shot on
// a nearly-spent unit pays only what it actually removed. The check covers a posed unit
// with a tower of a known per-shot damage, runs the real sim onto the first hit, and reads
// the energy delta that hit produced.
//
// FOUR scenarios, so FOUR runs. Only the first is arranged (it opens from a seeded reset);
// the rest are posed inside `act` with `poseCoverAndSpawn`, the twin that uses control ops
// alone — `api.reset` throws in `act`.

import {
  coverAndSpawn,
  poseCoverAndSpawn,
  clipBudget,
  TICK,
} from "../_helpers.mjs";

const MAX_PAYOUT_TICKS = 480; // 8 s cap for the first hit to land
// How long each of the four pairings is held after its payout is read. The payout must be
// read on the exact step the first shot lands — a coarser read or a lead-in lets a SECOND
// shot land inside it and the figure is then about two hits, not one — so the window this
// item needs for the reviewer has to come after the reading, not before it. Two seconds
// apiece is long enough to see the energy read settle on what that one hit paid.
const HOLD_TICKS = 120;

/**
 * Pose a covered unit with an empty bank. Energy starts at 0 so the delta is unambiguous,
 * and the tower is bought before the baseline is taken. `pose` opens the run.
 */
async function posePayout(api, pose, { kind, electrons }) {
  const { unitId } = await pose(api, { kind, type: "atom", electrons });
  await api.call("setEnergy", 0);
  return { unitId, energy0: (await api.snapshot()).energy };
}

// Run until the covering tower lands its first hit, and return the energy it paid.
// A hit is visible either as energy arriving or as the unit losing shells / dying.
async function actPayout(api, { unitId, energy0 }) {
  // 480 ticks = the old 8 s cap, polled every TICK: the payout is read on the exact step
  // the first shot lands, and a coarser poll could let a second shot land inside it.
  const r = await api.until(
    (s) => s.energy !== energy0 || !s.matter.some((u) => u.id === unitId),
    {
      max: MAX_PAYOUT_TICKS,
      poll: TICK,
    },
  );
  const paid = r.snap.energy - energy0;
  // Read first, then held: see HOLD_TICKS.
  await api.advance(HOLD_TICKS);
  return { paid, resolved: r.hit };
}

export default function item() {
  let posedOneOnOne;
  let oneOnOne;
  let oneOnTwo;
  let twoOnTwo;
  let twoOnOne;

  return {
    id: "economy.damage-pays",

    clipMs: clipBudget(4 * (MAX_PAYOUT_TICKS / 4 + HOLD_TICKS)),

    // An Emitter strips one shell a shot; a Cleaver strips two. The first pairing is the
    // run this item arranges.
    async arrange(api) {
      posedOneOnOne = await posePayout(api, coverAndSpawn, {
        kind: "emitter",
        electrons: 1,
      });
    },

    // Each pairing's first hit, in turn.
    async act(api) {
      oneOnOne = await actPayout(api, posedOneOnOne);

      oneOnTwo = await actPayout(
        api,
        await posePayout(api, poseCoverAndSpawn, {
          kind: "emitter",
          electrons: 2,
        }),
      );
      twoOnTwo = await actPayout(
        api,
        await posePayout(api, poseCoverAndSpawn, {
          kind: "cleaver",
          electrons: 2,
        }),
      );
      twoOnOne = await actPayout(
        api,
        await posePayout(api, poseCoverAndSpawn, {
          kind: "cleaver",
          electrons: 1,
        }),
      );
    },

    async assert(api, check) {
      check.expectEq("a 1-damage shot pays 1", oneOnOne.paid, 1);
      check.expectEq(
        "a 1-damage shot on a 2-shell unit pays 1",
        oneOnTwo.paid,
        1,
      );
      check.expectEq(
        "a 2-damage shot on a 2-shell unit pays 2",
        twoOnTwo.paid,
        2,
      );
      check.expectEq(
        "a 2-damage shot on a 1-shell unit pays only 1",
        twoOnOne.paid,
        1,
      );
    },
  };
}
