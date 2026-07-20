// Automated validation for the Game States sub-item `pause-freezes-tick`.
//
// While the game is paused the simulation does not advance: the snake, its head cell,
// and the tick count do not change. A round is run a little, paused, then far more
// than a couple of seconds is let pass in BOTH simulation time (step) and real time
// (a live clip) — nothing must advance and the screen must stay paused.

import { TICK_DT, hLane, PARK_PELLET, sameCell, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.pause-freezes-tick");

  await beginRound(api);
  await api.call("setSnake", hLane(8, 8, 3), "right");
  await api.call("setPellet", PARK_PELLET);
  await api.step(1.0); // run one second -> 8 ticks
  const running = await api.snapshot();
  check.expectEq("the round advanced before pausing", running.ticks, 8);

  await api.call("press", "Escape"); // pause
  check.expectEq("the game is paused", (await api.snapshot()).screen, "paused");

  await api.step(2.0); // two seconds of sim time while paused
  const afterStep = await api.snapshot();
  check.expectEq("the tick count did not advance while paused", afterStep.ticks, running.ticks);
  check.expectOk("the head did not move while paused", sameCell(afterStep.snake[0], running.snake[0]));
  check.expectEq("the screen is still paused", afterStep.screen, "paused");

  // A live clip: real time passes while paused and the snake stays frozen.
  await api.call("setAutoStep", true);
  await api.wait(1200);
  const afterLive = await api.snapshot();
  check.expectEq("real time also does not advance the tick while paused", afterLive.ticks, running.ticks);
  check.expectEq("still paused after real time passed", afterLive.screen, "paused");

  return check.verdict();
}
