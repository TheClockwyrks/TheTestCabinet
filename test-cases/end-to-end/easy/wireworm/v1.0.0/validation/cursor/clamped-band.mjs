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

/**
 * ACT-phase probe: park the cursor, hold a key into one bound for `ticks`, and read
 * the clamped position back. `setCursor`/`keyDown`/`keyUp` are control ops, so this
 * re-poses each successive probe without ever touching `api.reset` (forbidden in
 * `act`, where it would take the clock back and freeze the recording).
 */
async function pinAgainst(api, startX, startY, code, ticks) {
  await api.call("setCursor", startX, startY);
  await api.call("keyDown", code);
  await api.advance(ticks);
  const c = (await api.snapshot()).cursor;
  await api.call("keyUp", code);
  return c;
}

// The vertical band is only ~32px tall, so a second of held input pins it.
const VERTICAL_TICKS = 120; // 120 ticks = the old 1.0s

// The horizontal sweeps now start at the far edges (see `act`), so they cross the
// band's full 1248 px of travel rather than the ~1000 the old starts left. Four
// seconds is what keeps that from quietly becoming a SPEED requirement: 1248 px in
// the old 3 s would demand 416 px/s of a build, and specs/controls.md fixes no
// cursor speed at all — it asks only that movement be "responsive enough to dodge a
// diving worm and a skittering glitch". At 480 ticks the item still only needs
// ~312 px/s, which is less than the old sweep demanded, so widening what the clip
// shows does not narrow what the check accepts.
const HORIZONTAL_TICKS = 480; // 4.0s

export default function item() {
  let up;
  let down;
  let left;
  let right;

  return {
    id: "cursor.clamped-band",

    // The four probes are ten seconds of held input end to end, which is more than
    // the default filming budget: without this the last probe would be cut off
    // mid-sweep and the clip would end before the cursor reached the bound it is
    // being checked against.
    clipMs: 10_500,

    async arrange(api) {
      await freshBoard(api);
    },

    // The four probes run back to back, each re-posed with control ops. This IS the
    // clip: the reviewer watches the cursor pin against each of the four bounds in
    // turn, which is exactly what the assertions read.
    //
    // The leftward probe starts at the RIGHT bound, so the sweep it films is the
    // whole width of the band. It used to start at x = 1000 — three-quarters of the
    // way across — which read as a cursor setting off from nowhere in particular;
    // from the right edge it plainly runs the band end to end. (This changes nothing
    // about the check: every probe asserts the bound it finishes on, never the
    // distance travelled.)
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
        CURSOR_X_MAX,
        688,
        "ArrowLeft",
        HORIZONTAL_TICKS,
      );
      right = await pinAgainst(api, 200, 688, "ArrowRight", HORIZONTAL_TICKS);
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
