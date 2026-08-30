// Automated validation for cursor.move-speed: a held movement key slides the cursor
// at the specified 430 px/s.
//
// specs/controls.md fixes the rate, because "responsive" is not a property a build
// can be held to: the cursor's whole job is to outrun a diving worm and a skittering
// glitch across the band, and how fast it covers ground decides whether the game is
// playable. Every other control item reads only DIRECTION — that holding a key moves
// the cursor the way it should — so a build whose cursor crawls satisfies all of them.
//
// The measurement is a held key over an exact tick window, read from the real
// moveCursor code. Both probes run in the middle of the band, far enough from the side
// edges that the clamp never truncates the travel being measured — a probe that runs
// into a bound measures the bound, not the speed.

import {
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  freshBoard,
  TICK_HZ,
} from "../_helpers.mjs";

// specs/controls.md: a held movement key slides the cursor at this rate.
const SPEED = 430; // px/s

/**
 * How far the measured speed may sit from the specified rate, as a fraction.
 *
 * Wide on purpose. What this item is here to catch is a cursor that does not move at
 * the speed the game is balanced around — one that crawls, or one that snaps across
 * the band untouchably fast — not the last few px/s of a build that integrates its
 * movement slightly differently across the window's boundary frames. At 15% the
 * accepted band is 365..495 px/s, which no build aiming at 430 will fall outside and
 * no build aiming at some other number will land inside.
 */
const TOLERANCE = 0.15;

const WINDOW_TICKS = 120; // 1.0s of held input — the measured window
const EXPECTED_PX = SPEED * (WINDOW_TICKS / TICK_HZ);

// The probes start here: 200 px in from either side edge, so a conformant cursor
// finishes ~430 px later still ~600 px clear of the bound ahead of it.
const LEFT_START = 200;
const RIGHT_START = 1080;
const BAND_Y = 688; // mid-band, clear of the floor and the band top

// A beat on the posed start before the key goes down, and one on the result after the
// window is read, purely so the clip reads as a slide rather than a jump. Neither can
// affect the measurement, which is captured between them.
const LEAD_TICKS = 12;
const TAIL_TICKS = 12;

/**
 * ACT-phase probe: park the cursor, hold `code` for exactly `WINDOW_TICKS`, and return
 * how far it travelled in x over that window. Control ops only, so each probe re-poses
 * the next without `api.reset` (forbidden in `act`).
 */
async function measure(api, startX, code) {
  await api.call("setCursor", startX, BAND_Y);
  await api.advance(LEAD_TICKS);
  const before = (await api.snapshot()).cursor;
  await api.call("keyDown", code);
  await api.advance(WINDOW_TICKS);
  const after = (await api.snapshot()).cursor;
  await api.advance(TAIL_TICKS);
  await api.call("keyUp", code);
  return { dx: after.x - before.x, before, after };
}

export default function item() {
  let right;
  let left;

  return {
    id: "cursor.move-speed",

    async arrange(api) {
      await freshBoard(api);
    },

    // Both probes ARE the clip: the reviewer watches the cursor cover a measured
    // second of band in each direction, which is what the assertions read.
    async act(api) {
      right = await measure(api, LEFT_START, "ArrowRight");
      left = await measure(api, RIGHT_START, "ArrowLeft");
    },

    async assert(api, check) {
      const tolerance = EXPECTED_PX * TOLERANCE;
      check.expectClose(
        "holding Right moves the cursor 430 px in one second",
        right.dx,
        EXPECTED_PX,
        tolerance,
      );
      check.expectClose(
        "holding Left moves the cursor 430 px in one second",
        -left.dx,
        EXPECTED_PX,
        tolerance,
      );
      // Neither probe may have run into a bound: a clamped probe stops early and reads
      // as a slow cursor, which is a different failure from the one above and must not
      // be reported as it. Both starts leave ~600 px of clearance, so this only fires
      // on a build whose cursor is far faster than specified.
      check.expectLt(
        "the rightward probe finished clear of the right edge",
        right.after.x,
        CURSOR_X_MAX,
      );
      check.expectGt(
        "the leftward probe finished clear of the left edge",
        left.after.x,
        CURSOR_X_MIN,
      );
    },
  };
}
