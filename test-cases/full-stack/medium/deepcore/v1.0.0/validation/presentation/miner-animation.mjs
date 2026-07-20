// Automated validation for presentation.miner-animation (the headline).
//
// The miner must animate a distinct cycle for each thing it does. Validation can only confirm the
// state machine REACHES each distinct animation state (idle, walk, drill-down, drill-side, jetpack,
// fall) and record a clip; whether the produced sprites read as characterful, distinct cycles is
// judged by eye from the video. We pose each state and read miner.state back, then record a live clip.

import { K, newRun, standAt, solid, openColumn, SPAWN_COL, TOPSOIL_ROW, ROCKBED_ROW } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("presentation.miner-animation");
  const col = SPAWN_COL;

  await newRun(api);

  // idle — standing still on the surface.
  await api.step(0.2);
  check.expectEq("reaches the idle cycle", (await api.snapshot()).miner.state, "idle");

  // walk — holding a direction on solid ground.
  await api.call("keyDown", K.right);
  await api.step(0.3);
  check.expectEq("reaches the walk cycle", (await api.snapshot()).miner.state, "walk");
  await api.call("keyUp", K.right);

  // drill-down — cutting the tile below.
  await standAt(api, col, TOPSOIL_ROW);
  await solid(api, col, TOPSOIL_ROW + 2);
  await api.call("keyDown", K.down);
  await api.step(0.2);
  check.expectEq("reaches the drill-down cycle", (await api.snapshot()).miner.state, "drill-down");
  await api.call("keyUp", K.down);

  // drill-side — cutting into a wall.
  await standAt(api, col, ROCKBED_ROW);
  await solid(api, col + 1, ROCKBED_ROW);
  await api.call("keyDown", K.right);
  await api.step(0.35);
  check.expectEq("reaches the drill-side cycle", (await api.snapshot()).miner.state, "drill-side");
  await api.call("keyUp", K.right);

  // jetpack — thrusting up an open shaft.
  await api.call("teleport", col, ROCKBED_ROW);
  await openColumn(api, col, ROCKBED_ROW - 5, ROCKBED_ROW - 1);
  await solid(api, col, ROCKBED_ROW + 1);
  await api.call("teleport", col, ROCKBED_ROW);
  await api.call("setFuel", 999);
  await api.call("keyDown", K.thrust);
  await api.step(0.2);
  check.expectEq("reaches the jetpack cycle", (await api.snapshot()).miner.state, "jetpack");
  await api.call("keyUp", K.thrust);

  // fall — plunging down an open shaft.
  await api.call("teleport", col, ROCKBED_ROW);
  await openColumn(api, col, ROCKBED_ROW + 1, ROCKBED_ROW + 10);
  await solid(api, col, ROCKBED_ROW + 11);
  await api.call("teleport", col, ROCKBED_ROW);
  await api.step(0.2);
  check.expectEq("reaches the fall cycle", (await api.snapshot()).miner.state, "fall");

  // A live clip of the miner in motion for the reviewer to judge the sprites.
  await api.call("setAutoStep", true);
  await api.wait(1200);
  return check.verdict();
}
