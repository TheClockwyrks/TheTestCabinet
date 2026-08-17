// Automated validation for the Sink sub-item `cools`.
//
// A Sink touching a hot emitter draws its heat down faster than open air alone
// (specs/heat.md). We cool the same hot Arc with and without a Sink neighbour and
// compare — the Sink version ends cooler.
//
// BOTH ARCS COOL AT ONCE, SIDE BY SIDE.
//
// This used to cool one layout, restart the match, and cool the other. That is sound and
// it is unreadable: the clip showed one tower's heat bar falling, a cut, then a second
// tower's heat bar falling, and a reviewer had to carry the first number across the cut
// and compare it to the second from memory — on two bars that were never on screen
// together. Posing both on the same floor and running one cooling step over the pair puts
// the comparison in a single frame: two heat reads starting level and visibly separating,
// with the difference between them being one tower's south neighbour.
//
// The two sit eight rows apart and share no edge, so neither Arc conducts into the other
// (conduction needs touching footprints, specs/heat.md) and the Sink reaches only the Arc
// it was placed under.

import { newGame, build, heatOf } from "../_helpers.mjs";

// The two Arcs: one with a Sink on its south face, one with nothing.
const SINK_ROW = 12;
const BARE_ROW = 20;
const ARC_COL = 12;
const START_HEAT = 80;

// 90 ticks (1.5 s) of cooling, applied to both by the same ticks of the same simulation.
// Long enough that the two bars are plainly apart by the end and the fall itself reads
// as a fall.
const COOL_TICKS = 90;

// Pose a hot Arc, with a Sink on its south face if `withSink`, and return its id.
async function poseArc(api, row, withSink) {
  const id = await build(api, "arc", ARC_COL, row);
  if (withSink) await build(api, "sink", ARC_COL, row + 2);
  await api.call("setHeat", id, START_HEAT);
  return id;
}

export default function item() {
  let sinkId;
  let bareId;
  let withSink;
  let without;

  return {
    id: "sink.cools",

    // Both layouts are posed up front, on one floor, so the drive is a single cooling
    // step over the pair rather than two runs to be held in mind across a cut.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      sinkId = await poseArc(api, SINK_ROW, true);
      bareId = await poseArc(api, BARE_ROW, false);
    },

    async act(api) {
      await api.advance(COOL_TICKS);
      withSink = await heatOf(api, sinkId);
      without = await heatOf(api, bareId);
    },

    async assert(api, check) {
      // Both start at the same heat, so a build that cooled NEITHER reports them equal
      // and would sail through a bare `<` comparison. Something has to have been shed
      // before which of them shed more can mean anything.
      check.expectLt("the open-air Arc cooled at all", without, START_HEAT);
      check.expectLt(
        "a Sink cools a hot gun faster than open air alone",
        withSink,
        without,
      );
    },
  };
}
