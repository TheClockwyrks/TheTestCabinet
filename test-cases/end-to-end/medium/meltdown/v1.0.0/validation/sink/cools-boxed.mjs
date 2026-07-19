// Automated validation for the Sink sub-item `cools-boxed`.
//
// A Sink cools an emitter through a face that touches it — even a face with no open
// air — so it is the only way to cool a boxed-in tower (specs/heat.md). We box an Arc
// on all four faces (with Forges, which touch but do not conduct or cool) and pose it
// above the Forge setpoint so the Forges add nothing; with no open air it holds its
// heat. Swapping one Forge for a Sink lets it cool through that walled face, so it
// ends cooler.

import { newGame, build, heatOf, liveClip } from "../_helpers.mjs";

// Box an Arc; the east neighbor is a Sink if `sinkEast`, else a Forge. Cool for
// `secs` from 80 heat (above the 72 setpoint, so the Forges are inert) and return
// the Arc's heat.
async function boxedCool(api, sinkEast, secs) {
  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  await build(api, "forge", 12, 10); // N
  await build(api, "forge", 12, 14); // S
  await build(api, "forge", 10, 12); // W
  await build(api, sinkEast ? "sink" : "forge", 14, 12); // E
  await api.call("setHeat", arc, 80);
  await api.step(secs);
  return heatOf(api, arc);
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sink.cools-boxed");

  const withSink = await boxedCool(api, true, 0.4);
  const allWalled = await boxedCool(api, false, 0.4);

  check.expectClose("a fully-boxed gun with no Sink barely cools", allWalled, 80, 1.5);
  check.expectLt("a Sink cools the boxed gun through its walled face", withSink, allWalled);

  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  await build(api, "forge", 12, 10);
  await build(api, "forge", 12, 14);
  await build(api, "forge", 10, 12);
  await build(api, "sink", 14, 12);
  await api.call("setHeat", arc, 95);
  await liveClip(api, 1600);
  return check.verdict();
}
