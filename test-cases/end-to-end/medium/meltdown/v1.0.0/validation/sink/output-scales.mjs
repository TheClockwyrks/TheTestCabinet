// Automated validation for the Sink sub-item `output-scales`.
//
// A Sink's cooling rises with its level (16/24/36 per edge; specs/heat.md,
// towers.md), so a maxed Sink pulls heat down faster than a level-I one. We cool the
// same hot Arc with a level-I and a level-III Sink (upgraded through the real upgrade
// code) and compare.

import { newGame, build, heatOf, liveClip } from "../_helpers.mjs";

async function coolWithSink(api, sinkLevel, secs) {
  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  const sink = await build(api, "sink", 12, 14);
  for (let l = 1; l < sinkLevel; l += 1) await api.call("upgradeTower", sink);
  await api.call("setHeat", arc, 90);
  await api.step(secs);
  return heatOf(api, arc);
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sink.output-scales");

  const l1 = await coolWithSink(api, 1, 0.6);
  const l3 = await coolWithSink(api, 3, 0.6);

  check.expectLt("a level-III Sink cools faster than a level-I Sink", l3, l1);

  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  const sink = await build(api, "sink", 12, 14);
  await api.call("upgradeTower", sink);
  await api.call("upgradeTower", sink);
  await api.call("setHeat", arc, 95);
  await liveClip(api, 1600);
  return check.verdict();
}
