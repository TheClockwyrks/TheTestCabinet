// Automated validation for the Sink sub-item `output-scales`.
//
// A Sink's cooling rises with its level (16/24/36 per edge; specs/heat.md,
// towers.md), so a maxed Sink pulls heat down faster than a level-I one. We cool the
// same hot Arc under a level-I and a level-III Sink (upgraded through the real upgrade
// code) and compare.
//
// BOTH PAIRS COOL AT ONCE, SIDE BY SIDE.
//
// This used to cool one layout, restart the match, and cool the other. That is sound and
// it is unreadable: the clip showed one tower's heat bar falling, a cut, then a second
// tower's heat bar falling, and a reviewer had to carry the first number across the cut
// and compare it to the second from memory — on two bars that were never on screen
// together. Posing both pairs on the same floor and running one cooling step over them
// puts the comparison in a single frame: two heat reads starting level and visibly
// separating, with the difference between them being one Sink's level.
//
// The pairs sit eight rows apart and share no edge, so neither Arc conducts into the
// other (conduction needs touching footprints, specs/heat.md) and neither Sink reaches
// the other Arc.

import { newGame, build, heatOf, tower } from "../_helpers.mjs";

const L1_ROW = 12;
const L3_ROW = 20;
const ARC_COL = 12;
const START_HEAT = 90;

// 60 ticks (1 s) of cooling, applied to both by the same ticks of the same simulation.
// A level-III Sink pulls more than twice a level-I one, so a second is plenty to open a
// visible gap without either bar bottoming out.
const COOL_TICKS = 60;

// Pose a hot Arc with a Sink on its south face upgraded to `sinkLevel` through the real
// upgrade code, and return both ids.
async function poseWithSink(api, row, sinkLevel) {
  const arc = await build(api, "arc", ARC_COL, row);
  const sink = await build(api, "sink", ARC_COL, row + 2);
  for (let l = 1; l < sinkLevel; l += 1) await api.call("upgradeTower", sink);
  await api.call("setHeat", arc, START_HEAT);
  return { arc, sink };
}

export default function item() {
  let l1Pair;
  let l3Pair;
  let l1Level;
  let l3Level;
  let l1;
  let l3;

  return {
    id: "sink.output-scales",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      l1Pair = await poseWithSink(api, L1_ROW, 1);
      l3Pair = await poseWithSink(api, L3_ROW, 3);
      l1Level = (await tower(api, l1Pair.sink)).level;
      l3Level = (await tower(api, l3Pair.sink)).level;
    },

    async act(api) {
      await api.advance(COOL_TICKS);
      l1 = await heatOf(api, l1Pair.arc);
      l3 = await heatOf(api, l3Pair.arc);
    },

    async assert(api, check) {
      // The premise: the two Sinks really are at different levels. A build whose upgrade
      // did nothing reports both at I, and the comparison below would be between two
      // identical layouts.
      check.expectEq("the control Sink is level I", l1Level, 1);
      check.expectEq("the other was upgraded to level III", l3Level, 3);

      check.expectLt("the level-I Sink cooled its Arc at all", l1, START_HEAT);
      check.expectLt(
        "a level-III Sink cools faster than a level-I Sink",
        l3,
        l1,
      );
    },
  };
}
