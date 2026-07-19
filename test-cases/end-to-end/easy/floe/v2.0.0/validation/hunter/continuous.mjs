// Automated validation for the Hunter item `continuous`.
//
// The bear moves continuously (pacman-style): each fixed step is a smooth sub-tile
// glide along a single axis — never diagonal, never a whole-tile jump. A bear is
// placed off the critter's column so its route requires turns, then its motion is
// sampled as it glides. See validation/_helpers.mjs.

import { startCrossing, clearIce, FIXED, TILE } from "../_helpers.mjs";

// How far (in tiles) a strait-local pixel coordinate sits from the nearest tile
// grid line. Zero means exactly tile-aligned on that axis.
function offTile(px) {
  const t = px / TILE;
  return Math.abs(t - Math.round(t));
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hunter.continuous");

  await startCrossing(api);
  await clearIce(api); // a clear board so the bear glides plainly toward the critter
  await api.call("placeCritter", 20, 10); // median, solid
  await api.call("setBear", 0, { col: 15, row: 16 }); // off-column, so it must turn

  let prev = (await api.snapshot()).bears[0];
  let maxOffTile = 0; // worst simultaneous off-grid on BOTH axes at once (a diagonal)
  let maxStep = 0; // largest jump between reads (a whole-tile teleport)
  let moved = false;
  for (let k = 0; k < 60; k += 1) {
    await api.step(FIXED);
    const b = (await api.snapshot()).bears[0];
    if (!b.present) break;
    // A single-axis glide is always exactly tile-aligned on the axis it is NOT
    // gliding along, so at any instant at most one axis is off the tile grid. This
    // is read from ONE snapshot, so an incidental extra on-screen frame between
    // reads cannot make an axis-aligned mover look diagonal; a genuinely diagonal
    // mover is off-grid on both axes at once.
    maxOffTile = Math.max(maxOffTile, Math.min(offTile(b.x), offTile(b.y)));
    const dx = Math.abs(b.x - prev.x);
    const dy = Math.abs(b.y - prev.y);
    maxStep = Math.max(maxStep, dx, dy);
    if (dx + dy > 1e-4) moved = true;
    prev = b;
  }
  check.expectOk("the bear actually glided", moved);
  check.expectLt("every step moves along a single axis (never diagonal)", maxOffTile, 0.05);
  check.expectLt("every step is a sub-tile glide (never a whole-tile jump)", maxStep, TILE);

  // Clip: the bear gliding toward the critter in real time.
  await startCrossing(api);
  await clearIce(api);
  await api.call("placeCritter", 20, 10);
  await api.call("setBear", 0, { col: 15, row: 16 });
  await api.call("setAutoStep", true);
  await api.wait(1500);

  return check.verdict();
}
