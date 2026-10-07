// Wireworm — progression/contact: the arrangement the five suites about a LOST
// LIFE share, and nothing else.
//
// specs/progression.md hangs five separate consequences off one event — lives
// falls by one, the rosters are swept, the cursor goes back to the band's
// center, the phase becomes `respawn`, and a contact with no lives to spare ends
// the run instead — and specs/cursor.md fixes the event itself: a worm segment
// reaches the cursor when the segment's TILE overlaps the cursor's box. Each of
// those consequences is its own point, and each needs the same contact to
// happen first.
//
// So this poses the least ambiguous contact the two files allow: the cursor's
// center exactly on a band tile's center, and one worm of one segment standing
// on that same tile. The tile's `32 x 32` square and the cursor's `24 x 24` box
// are then concentric, so the overlap is unmistakable however a build rounds an
// edge — which matters, because the cursor's own resting place, the band's
// center `(640, 688)`, sits on a four-tile corner where an edge test could
// legitimately fall either way.
//
// IT FIXES ARRANGEMENT AND NOTHING ELSE. Which tile the contact happens on, and
// that the segment standing there is a target rather than a traveller. Lives,
// levels, and every figure the five suites assert are stated in the suite that
// asserts them.

import { poseWorm, tileCenter, type Harness } from "../harness";

/**
 * The tile a contact is posed on: mid-board horizontally, on the floor row.
 *
 * Row `19` is the lower of the two player-band rows (specs/board.md), and its
 * center `y` is `704` — exactly `CURSOR_Y_MAX`, so the cursor really can rest
 * there and `setCursor`'s band clamp leaves the pose where it was put.
 */
export const CONTACT_C = 20;
export const CONTACT_R = 19;

/**
 * Put the cursor on tile `(c, r)` with one stationary worm segment standing on
 * it, the contact test running and no invulnerability left, and answer the
 * worm's id.
 *
 * The contact gate is turned back ON here — `startPlaying` leaves all three
 * world gates off — because the cursor's contact test IS the faculty every
 * suite that calls this is about (specs/instrumentation.md, setCursorContact).
 * Nothing else is re-enabled: no foe arrives, no worm enters, and the only thing
 * that can reach the cursor is the segment posed on it.
 *
 * The segment's step is gated off, so it is a thing standing on the cursor's
 * tile rather than a worm travelling through it: the contact is decided by where
 * it was PUT, not by where a build's step clock would have carried it.
 */
export function poseContact(
  h: Harness,
  c: number = CONTACT_C,
  r: number = CONTACT_R,
): number {
  h.debug.setCursorContact(true);
  h.debug.setCursorInvulnerable(0);
  const { x, y } = tileCenter(c, r);
  h.debug.setCursor(x, y);
  const wormId = poseWorm(h, c, r);
  h.debug.setWormStepping(wormId, false);
  return wormId;
}
