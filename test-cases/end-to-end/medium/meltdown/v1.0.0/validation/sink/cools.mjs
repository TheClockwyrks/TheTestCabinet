// Automated validation for the Sink sub-item `cools`.
//
// A Sink touching a hot emitter draws its heat down faster than open air alone
// (specs/heat.md). We cool the same hot Arc with and without a Sink neighbor and
// compare — the Sink version ends cooler.

import { newGame, build, heatOf, liveClip } from "../_helpers.mjs";

async function coolFor(api, withSink, secs) {
  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  if (withSink) await build(api, "sink", 12, 14);
  await api.call("setHeat", arc, 80);
  await api.step(secs);
  return heatOf(api, arc);
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sink.cools");

  const withSink = await coolFor(api, true, 1);
  const without = await coolFor(api, false, 1);

  check.expectLt("a Sink cools a hot gun faster than open air alone", withSink, without);

  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  await build(api, "sink", 12, 14);
  await api.call("setHeat", arc, 95);
  await liveClip(api, 1600);
  return check.verdict();
}
