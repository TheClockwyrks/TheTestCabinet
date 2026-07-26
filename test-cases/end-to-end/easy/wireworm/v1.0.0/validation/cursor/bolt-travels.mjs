// Automated validation for cursor.bolt-travels: a bolt TRAVELS up the column at
// about 900 px/s, rather than resolving against a distant target the instant it is
// fired.
//
// `specs/controls.md` specifies travel, not just outcome: a bolt "spawns at the
// cursor's muzzle and travels straight up at about 900 px/s, stopping at the first
// node, worm segment, or foe in its column". Every other firing item reads only the
// OUTCOME — the node cleared, the bolt consumed — and an implementation that
// resolves the whole column on the tick of the shot satisfies all of them while
// never putting a bolt on screen. That is a real defect (it makes anything that
// shields itself behind a node unhittable, and there is nothing to watch), so this
// item checks the flight itself: a single node is posed at the top of an otherwise
// empty column and the bolt is watched crossing the gap.

import { chargeAt, freshBoard, tileCX, TICK } from "../_helpers.mjs";

// The node sits at row 1; the bolt leaves the muzzle just above the cursor at the
// bottom of the band, so it has ~550 logical px to climb. At the specified 900 px/s
// that is ~0.6s, or ~74 ticks.
const NODE_ROW = 1;
const NODE_COL = 20;

// How far in we assert the bolt is STILL climbing. Generous on purpose: it is a
// third of the nominal flight, so it holds for any build within a wide margin of
// 900 px/s, while an instant resolve (0 ticks) misses it by the whole distance.
const MID_FLIGHT_TICKS = 24;

export default function item() {
  let atFire;
  let midFlight;
  let resolved;

  return {
    id: "cursor.bolt-travels",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", NODE_COL, NODE_ROW, 0);
      await api.call("setCursor", tileCX(NODE_COL), 704); // directly below it
    },

    // The flight IS the clip: the reviewer watches the bolt climb the empty column
    // and strike the node at the top.
    async act(api) {
      await api.call("fire");
      await api.advance(TICK);
      atFire = await api.snapshot();

      await api.advance(MID_FLIGHT_TICKS);
      midFlight = await api.snapshot();

      const r = await api.until((s) => s.bolts.length === 0, {
        max: 240, // 2s — comfortably past the ~0.6s the climb should take
        poll: TICK,
      });
      resolved = r.snap;
    },

    async assert(api, check) {
      check.expectEq("firing puts a bolt in flight", atFire.bolts.length, 1);

      // The heart of it: a bolt fired at a node ~550px away is still in the air a
      // quarter-second later. A build that resolves the column on the firing tick
      // fails here with zero bolts, however correct its outcome.
      check.expectEq(
        "the bolt is still climbing well after it was fired",
        midFlight.bolts.length,
        1,
      );
      check.expectLt(
        "the bolt has climbed the column while in flight (y decreasing)",
        midFlight.bolts[0]?.y ?? Infinity,
        atFire.bolts[0]?.y ?? 0,
      );

      // And it still resolves the way the other firing items expect.
      check.expectEq(
        "the travelling bolt clears the node it reaches",
        chargeAt(resolved, NODE_COL, NODE_ROW),
        -1,
      );
    },
  };
}
