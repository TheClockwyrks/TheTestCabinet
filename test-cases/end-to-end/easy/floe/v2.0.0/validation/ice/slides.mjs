// Automated validation for the Ice band item `slides`.
//
// Each ice lane's vehicles slide along the lane by its own direction and speed as
// the simulation advances. For each lane one item is tracked across a real step
// and its displacement compared to dir*speed*TILE*dt. Items wrap seamlessly
// within the lane's track, so the tracked item is chosen NOT to cross the wrap
// boundary during the (tiny) step — the bottom-most item when the lane slides
// toward higher x, the top-most when it slides toward lower x — matched by index,
// since a step advances a lane's items in place without reordering them. See
// validation/_helpers.mjs.

import { startCrossing, TILE } from "../_helpers.mjs";

// The index of a lane item that will not cross the wrap boundary over a small
// forward step: moving toward higher x (dir >= 0) the max-x item can wrap, so
// track the min-x one; moving toward lower x the min-x item can wrap, so track
// the max-x one.
function safeItemIndex(items, dir) {
  let idx = 0;
  for (let k = 1; k < items.length; k += 1) {
    const nearerBoundary = dir >= 0 ? items[k].x < items[idx].x : items[k].x > items[idx].x;
    if (nearerBoundary) idx = k;
  }
  return idx;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ice.slides");

  await startCrossing(api);
  const before = (await api.snapshot()).lanes.ice;
  // Manual stepping advances the sim by exactly this much (no stray wall-clock
  // frames), so the slide equals dir*speed*TILE*dt to within float rounding.
  const dt = 0.5;
  await api.step(dt);
  const after = (await api.snapshot()).lanes.ice;

  for (let i = 0; i < before.length; i += 1) {
    const expected = before[i].dir * before[i].speed * TILE * dt;
    const idx = safeItemIndex(before[i].items, before[i].dir);
    const dx = after[i].items[idx].x - before[i].items[idx].x;
    check.expectClose(`ice lane ${i} slides by dir*speed*dt`, dx, expected, 1e-3);
  }

  // Clip: the traffic sliding along the lanes in real time.
  await api.call("setAutoStep", true);
  await api.wait(800);

  return check.verdict();
}
