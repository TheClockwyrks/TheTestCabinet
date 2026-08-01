// Automated validation for the Surface-cooling sub-item `radiator-better`.
//
// The radiator faces shed heat far better than plain faces (specs/heat.md). The
// comparison this item makes is about which faces point at the OPEN AIR — a radiator
// edge sheds 3.6 per edge-tile against a plain edge's 1.1 — and not about aiming
// anything at a Sink. A face touching a mover "sheds no heat to air" at all
// (specs/heat.md), so a radiator turned onto a Sink is a radiator wasted; the Sinks
// below are scenery, there only to take two faces out of the comparison.
//
// So: two Arcs, each with its east and west faces blocked by Sinks, differing only in
// rotation. At rotation 0 the Arc's radiator faces (local N/S, specs/towers.md) point
// at the open north and south air; at rotation 1 they have turned onto the Sinks and
// its plain faces have the open air instead. Both carry the identical pair of Sinks, so
// the Sinks' own cooling is the same term on both sides and cancels, and the only
// difference left is which kind of face is on the air. The radiator-facing Arc must end
// cooler.
//
// BOTH ARCS COOL AT ONCE, SIDE BY SIDE.
//
// This used to cool one layout, restart the match, and cool the other — which is sound,
// and unreadable. The clip showed one tower's heat bar falling, a cut, then another
// tower's heat bar falling, leaving a reviewer to carry the first number across the cut
// and compare it to the second from memory. Posing both on the same floor and running
// one cooling step over the pair puts the comparison in a single frame: two heat reads
// starting level and visibly separating.
//
// The pairs sit eight rows apart and share no edge, so neither Arc conducts into the
// other (conduction needs touching footprints, specs/heat.md) and neither Sink reaches
// the other Arc.
//
// ON THE SIZE OF THE GAP. It is real but not large, and that is this scenario's ceiling
// rather than any build's. A Sink sheds 16 per shared edge-tile (specs/towers.md)
// against a radiator edge's 3.6, so the two blocking Sinks contribute more cooling than
// every open face put together — equally to both Arcs, which is what makes them cancel,
// but it compresses the difference the rotation makes into a few points of heat. Sinks
// are nonetheless the only blocker available that does not corrupt the comparison: an
// emitter used as a wall would conduct across the very edge it is blocking, and a Forge
// would start warming whichever Arc first dropped below its setpoint. The window below
// is sized to where the two curves are furthest apart.

import { newGame, build, heatOf } from "../_helpers.mjs";

// The two Arcs, and the Sinks that blank their east and west faces.
const RAD_ROW = 12; // rotation 0 — radiator faces on the open N/S air
const PLAIN_ROW = 20; // rotation 1 — radiator faces turned onto the Sinks
const ARC_COL = 12;
const START_HEAT = 80;

// How long both Arcs cool for. The two curves are exponential and start together, so
// their absolute gap opens, peaks, and closes again as both approach zero; 90 ticks
// (1.5 s) sits at the top of that arc for this layout, which is the most a clip of it
// can show.
const COOL_TICKS = 90;

// Pose an Arc at `rot` with Sinks blocking its E and W faces, hot, and return its id.
async function poseBlocked(api, row, rot) {
  const id = await build(api, "arc", ARC_COL, row, rot);
  await build(api, "sink", ARC_COL - 2, row); // W
  await build(api, "sink", ARC_COL + 2, row); // E
  await api.call("setHeat", id, START_HEAT);
  return id;
}

export default function item() {
  let radId;
  let plainId;
  let radOpen;
  let plainOpen;

  return {
    id: "cooling.radiator-better",

    // Both Arcs are posed up front, on one floor, so the drive is a single cooling step
    // over the pair rather than two runs to be held in mind across a cut.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      radId = await poseBlocked(api, RAD_ROW, 0);
      plainId = await poseBlocked(api, PLAIN_ROW, 1);
    },

    // One cooling step, applied to both by the same ticks of the same simulation.
    async act(api) {
      await api.advance(COOL_TICKS);
      radOpen = await heatOf(api, radId);
      plainOpen = await heatOf(api, plainId);
    },

    async assert(api, check) {
      // Both start at the same heat, so a build that cooled NEITHER reports them equal
      // and would sail through a bare `<` comparison. Something has to have been shed
      // before which of them shed more can mean anything.
      check.expectLt(
        "the radiator-facing Arc cooled at all",
        radOpen,
        START_HEAT,
      );
      check.expectLt(
        "radiator faces on open air cool faster than plain faces",
        radOpen,
        plainOpen,
      );
    },
  };
}
