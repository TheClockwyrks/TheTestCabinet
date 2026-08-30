// Automated validation for cursor.clamped-band: the cursor moves freely but is
// clamped to the bottom player band — it cannot rise above the band, drop below the
// floor, or leave through the sides.
//
// Each bound is probed by parking the cursor a short way inside it, holding a
// movement key into it, and stepping the real moveCursor/clampCursor forward long
// enough to pin the cursor against that edge; the clamped position is read back and
// must sit exactly on the band limit.
//
// The probes start NEAR the bound they test, not across the board from it. This item
// asserts where the cursor comes to rest, and a probe that must cross the whole band
// within a fixed window before it can pin asserts something else as well: that the
// build covers that distance in that time, which is a SPEED requirement wearing a
// clamp item's name. A build slower than the sweep demands then fails a clamp it
// honours exactly. Cursor speed is a real requirement (specs/controls.md fixes it at
// 430 px/s) and is checked where it can be read directly, by cursor.move-speed. Each
// probe here needs only 120 px/s to reach its bound.

import {
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  freshBoard,
} from "../_helpers.mjs";

/**
 * How far inside a horizontal bound a probe starts. Far enough that the clip shows
 * the cursor visibly travelling into the edge and pinning there (rather than opening
 * already against it), and near enough that reaching it asks nothing of a build's
 * speed: 120 px in the 120 ticks below is 120 px/s.
 *
 * `setCursor` is what makes this possible — specs/instrumentation.md has it place the
 * cursor anywhere in the band, with the real clamp still applied — so a probe can be
 * posed beside the bound it tests instead of walked there.
 */
const EDGE_OFFSET = 120;

// The vertical band is only 32 px tall, so a vertical probe starts at the opposite
// bound and still crosses the whole of it in half a second at 64 px/s.
const VERTICAL_TICKS = 60; // 0.5s
const HORIZONTAL_TICKS = 120; // 1.0s

// A beat on the posed start before the key goes down, and a beat on the pinned result
// after the position is read. Neither can touch the verdict — nothing moves the cursor
// without input, and the reading is already captured — they only make the clip legible
// as a slide into a bound rather than a cut between two stills.
const LEAD_TICKS = 12;
const TAIL_TICKS = 12;

/**
 * ACT-phase probe: park the cursor, hold a key into one bound for `ticks`, and read
 * the clamped position back. `setCursor`/`keyDown`/`keyUp` are control ops, so this
 * re-poses each successive probe without ever touching `api.reset` (forbidden in
 * `act`, where it would take the clock back and freeze the recording).
 */
async function pinAgainst(api, startX, startY, code, ticks) {
  await api.call("setCursor", startX, startY);
  await api.advance(LEAD_TICKS);
  await api.call("keyDown", code);
  await api.advance(ticks);
  const c = (await api.snapshot()).cursor;
  await api.advance(TAIL_TICKS);
  await api.call("keyUp", code);
  return c;
}

export default function item() {
  let up;
  let down;
  let left;
  let right;

  return {
    id: "cursor.clamped-band",

    async arrange(api) {
      await freshBoard(api);
    },

    // The four probes run back to back, each re-posed with control ops. This IS the
    // clip: the reviewer watches the cursor pin against each of the four bounds in
    // turn, which is exactly what the assertions read.
    async act(api) {
      up = await pinAgainst(api, 640, CURSOR_Y_MAX, "ArrowUp", VERTICAL_TICKS);
      down = await pinAgainst(
        api,
        640,
        CURSOR_Y_MIN,
        "ArrowDown",
        VERTICAL_TICKS,
      );
      left = await pinAgainst(
        api,
        CURSOR_X_MIN + EDGE_OFFSET,
        688,
        "ArrowLeft",
        HORIZONTAL_TICKS,
      );
      right = await pinAgainst(
        api,
        CURSOR_X_MAX - EDGE_OFFSET,
        688,
        "ArrowRight",
        HORIZONTAL_TICKS,
      );
    },

    async assert(api, check) {
      check.expectClose(
        "held Up clamps at the band top",
        up.y,
        CURSOR_Y_MIN,
        0.5,
      );
      check.expectClose(
        "held Down clamps at the floor",
        down.y,
        CURSOR_Y_MAX,
        0.5,
      );
      check.expectClose(
        "held Left clamps at the left edge",
        left.x,
        CURSOR_X_MIN,
        0.5,
      );
      check.expectClose(
        "held Right clamps at the right edge",
        right.x,
        CURSOR_X_MAX,
        0.5,
      );
    },
  };
}
