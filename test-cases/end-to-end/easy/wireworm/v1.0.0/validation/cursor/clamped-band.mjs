// Automated validation for cursor.clamped-band: the cursor moves freely but is
// clamped to the bottom player band — it cannot rise above the band, drop below the
// floor, or leave through the sides.
//
// Each bound is probed by holding a movement key into it and stepping the real
// moveCursor/clampCursor forward long enough to pin the cursor against that edge;
// the clamped position is read back and must sit exactly on the band limit.

import {
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  freshBoard,
} from "../_helpers.mjs";

async function pinAgainst(api, startX, startY, code, seconds) {
  await api.call("setCursor", startX, startY);
  await api.call("keyDown", code);
  await api.step(seconds);
  const c = (await api.snapshot()).cursor;
  await api.call("keyUp", code);
  return c;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cursor.clamped-band");

  await freshBoard(api);

  const up = await pinAgainst(api, 640, 704, "ArrowUp", 1.0);
  check.expectClose("held Up clamps at the band top", up.y, CURSOR_Y_MIN, 0.5);

  const down = await pinAgainst(api, 640, 672, "ArrowDown", 1.0);
  check.expectClose("held Down clamps at the floor", down.y, CURSOR_Y_MAX, 0.5);

  const left = await pinAgainst(api, 1000, 688, "ArrowLeft", 3.0);
  check.expectClose("held Left clamps at the left edge", left.x, CURSOR_X_MIN, 0.5);

  const right = await pinAgainst(api, 200, 688, "ArrowRight", 3.0);
  check.expectClose("held Right clamps at the right edge", right.x, CURSOR_X_MAX, 0.5);

  // A live clip of the cursor sliding to and holding at the left edge.
  await freshBoard(api);
  await api.call("setCursor", 1000, 688);
  await api.call("setAutoStep", true);
  await api.call("keyDown", "ArrowLeft");
  await api.wait(1300);
  await api.call("keyUp", "ArrowLeft");

  return check.verdict();
}
