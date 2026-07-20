// Automated validation for the Turning sub-item `perpendicular-only`.
//
// Only a turn perpendicular to the current direction is accepted; a request to keep
// going straight is a no-op. While moving right: a straight request (ArrowRight) is
// ignored and the snake keeps its heading, while the two perpendicular requests
// (ArrowUp, ArrowDown) are accepted. Each case is posed fresh moving right (a
// precondition), the steering key is injected through the real handling, and the
// facing is read back after one real tick.

import { TICK_DT, hLane, PARK_PELLET, liveClip, beginRound } from "../_helpers.mjs";

async function turnResult(api, code) {
  await api.call("setSnake", hLane(10, 8, 3), "right");
  await api.call("setPellet", PARK_PELLET);
  await api.call("press", code);
  await api.step(TICK_DT);
  return (await api.snapshot()).dir;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("turning.perpendicular-only");

  await beginRound(api);

  check.expectEq(
    "a straight request (ArrowRight) while moving right is a no-op",
    await turnResult(api, "ArrowRight"),
    "right",
  );
  check.expectEq(
    "a perpendicular request (ArrowUp) while moving right is accepted",
    await turnResult(api, "ArrowUp"),
    "up",
  );
  check.expectEq(
    "a perpendicular request (ArrowDown) while moving right is accepted",
    await turnResult(api, "ArrowDown"),
    "down",
  );

  await liveClip(api, { snake: hLane(8, 8, 4), pellet: { col: 18, row: 8 } });
  return check.verdict();
}
