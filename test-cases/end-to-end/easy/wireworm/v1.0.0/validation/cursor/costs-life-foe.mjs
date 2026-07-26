// Automated validation for cursor.costs-life-foe: a foe touching the cursor costs a
// life.
//
// A foe posed on the cursor's position with lives to spare is the precondition; the
// life loss is produced by the real checkCursorHit when the sim steps, read back as
// a decremented life count.

import { freshBoard } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "cursor.costs-life-foe",

    // The glitch is posed ON the cursor, exactly as the old verdict did. The old
    // clip tail instead dropped one in from above, but a glitch zig-zags under the
    // real updateFoe and could dart clear of the cursor entirely — filming that
    // would show a scenario the assertions never drove, so the checked one wins.
    async arrange(api) {
      await freshBoard(api);
      await api.call("setLives", 3);
      await api.call("setCursor", 640, 688);
      await api.call("spawnFoe", "glitch", { x: 640, y: 688, vx: 0 }); // on the cursor
    },

    async act(api) {
      // `enterPlay` grants no spawn-in invulnerability (specs/instrumentation.md), so
      // this normally passes straight through. It is here so the check still measures
      // the hit — rather than a shielded cursor — on a build that reaches this state
      // carrying some, which specs/progression.md explicitly encourages.
      await api.until((s) => !s.cursor.invulnerable, { max: 600, poll: 6 });
      before = (await api.snapshot()).lives;
      await api.advance(6); // 6 ticks = the old 0.05s — one sim beat, enough for the touch
      after = (await api.snapshot()).lives;
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
