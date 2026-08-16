// Automated validation for cursor.costs-life-foe: a foe touching the cursor costs a
// life.
//
// A foe descending the cursor's own column, with lives to spare, is the
// precondition; the life loss is produced by the real checkCursorHit when the foe's
// own movement carries it onto the cursor, read back as a decremented life count.
//
// The foe REACHES the cursor rather than being posed on top of it. The old
// arrangement put a glitch straight onto the cursor, so the touch was over within
// 50 ms of `act` starting and the clip — which cannot begin filming the instant the
// pass does — opened on the respawn that followed it, showing the consequence of a
// contact a reviewer never got to see.

import { freshBoard, tileCY } from "../_helpers.mjs";

// The foe is a DROPPER, and that is what lets the approach be filmed at all:
// specs/foes.md has all three foes cost a life on contact, but of the three only the
// dropper "falls straight down a column". A glitch re-picks a random horizontal dart
// several times a second — that zig-zag is its defining behavior, and foes.glitch-
// zigzag checks exactly it — so a glitch released above the cursor would wander tiles
// clear of it and this check would be deciding on a coin toss. A dropper released in
// the cursor's column arrives, on any conformant build.
//
// The spec fixes no fall speed, so the approach is expressed as a DISTANCE — nine and
// a half tiles — and the wait polls for the outcome rather than counting ticks: on the
// reference's 150 px/s that is a two-second descent, and a build that falls faster or
// slower simply films its own.
const CURSOR_X = 640;
const CURSOR_Y = 688; // tile (20,19)
const DROP_FROM_ROW = 9;

export default function item() {
  let before;
  let after;

  return {
    id: "cursor.costs-life-foe",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setLives", 3);
      await api.call("setCursor", CURSOR_X, CURSOR_Y);
      await api.call("spawnFoe", "dropper", {
        x: CURSOR_X,
        y: tileCY(DROP_FROM_ROW),
      });
    },

    async act(api) {
      // `enterPlay` grants no spawn-in invulnerability (specs/instrumentation.md), so
      // this normally passes straight through. It is here so the check still measures
      // the hit — rather than a shielded cursor — on a build that reaches this state
      // carrying some, which specs/progression.md explicitly encourages.
      await api.until((s) => !s.cursor.invulnerable, { max: 600, poll: 6 });
      before = (await api.snapshot()).lives;
      // The dropper falls under its own speed and the real contact code decides when
      // it has arrived; polling for the life count is what makes the wait as long as
      // the descent actually takes. The cap is 4 s, comfortably past the ~2 s the
      // reference's fall needs.
      const hit = await api.until((s) => s.lives < before, {
        max: 480,
        poll: 6,
      });
      after = hit.snap.lives;
      // Both operands are captured; the sim runs on only so the clip shows the
      // respawn that follows rather than ending on a single frame.
      await api.advance(90); // 0.75s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("three lives before the hit", before, 3);
      check.expectEq("a foe reaching the cursor costs a life", after, 2);
    },
  };
}
