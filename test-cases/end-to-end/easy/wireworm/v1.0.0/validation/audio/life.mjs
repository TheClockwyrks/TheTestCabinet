// Automated validation for audio.life: a distinct cue plays when a life is lost.
//
// A foe posed on the cursor's position with lives to spare is the precondition
// (lives stay high so this death does not also end the game and fire the
// Game-over sting, keeping the cue isolated); the cue is confirmed by the Web
// Audio source log growing across the real checkCursorHit -> loseLife the touch
// triggers.

import { armAudio, audioCount, freshBoard } from "../_helpers.mjs";

export default function item() {
  let livesBefore;
  let before;
  let livesAfter;
  let after;

  return {
    id: "audio.life",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setLives", 3); // spare lives, so this death alone is isolated
      await api.call("setCursor", 640, 688);
      await api.call("spawnFoe", "glitch", { x: 640, y: 688, vx: 0 }); // on the cursor
      // Arm audio LAST: a genuine gesture is what unlocks a conformant build's
      // AudioContext, so it must land right before the driven event.
      await armAudio(api);
    },

    // The touch that costs the life is the clip and the one event this item
    // drives.
    async act(api) {
      // `enterPlay` grants no spawn-in invulnerability (specs/instrumentation.md),
      // so this normally passes straight through; it is here only to cover a build
      // that carries some anyway (specs/progression.md explicitly encourages it).
      await api.until((s) => !s.cursor.invulnerable, { max: 600, poll: 6 });
      livesBefore = (await api.snapshot()).lives;
      before = await audioCount(api);
      await api.advance(6); // 6 ticks = 0.05s — one sim beat, enough for the touch
      livesAfter = (await api.snapshot()).lives;
      after = await audioCount(api);
      // Every operand is captured; the sim runs on only so the clip shows the
      // respawn that follows rather than ending on a single frame.
      await api.advance(90); // 0.75s of visible aftermath
    },

    async assert(api, check) {
      check.expectGt("a life is lost on the touch", livesBefore, livesAfter);
      check.expectGt(
        "a cue plays on losing a life (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
