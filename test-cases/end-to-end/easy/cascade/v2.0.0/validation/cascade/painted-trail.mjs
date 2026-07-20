// Automated validation for the Victory-cascade sub-item `painted-trail`.
//
// Each in-flight card is drawn onto a persistent layer that is never cleared, so the
// table fills with dense arcs of overlapping cards (specs/victory.md). This reads the
// pixels the build actually PAINTS (api.pixel): after stepping the cascade well past
// all launches, points across the lower table — far from the foundations at the top —
// must show painted card pixels rather than bare felt.

import { colorDistance, FELT, sampleColor, winBoard } from "../_helpers.mjs";

const NOT_FELT = 60; // clearly a painted card pixel, not the green felt

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cascade.painted-trail");

  await winBoard(api, 11);
  // Run the cascade far enough that all 52 cards have launched and painted across the
  // floor band (launches finish by ~9.4 s; the trail persists thereafter).
  await api.step(12);
  await api.wait(150); // let a frame render the accumulated trail

  // Sample points well below the foundations: three along the floor band and one
  // higher in the arc region.
  const points = [
    [300, 650],
    [640, 650],
    [980, 650],
    [640, 520],
  ];
  let painted = 0;
  for (const [x, y] of points) {
    const c = await sampleColor(api, x, y);
    if (colorDistance(c, FELT) > NOT_FELT) painted += 1;
  }
  check.expectGe(
    "the painted trail fills the lower table with card pixels (not bare felt)",
    painted,
    3,
  );

  await api.screenshot("trail");
  return check.verdict();
}
