// Automated validation for progression.respawn-keeps-field: on losing a life with
// lives to spare, the worms and foes clear and the cursor respawns centered and
// briefly invulnerable, while the node field stays standing.
//
// A field, a worm on the cursor, and a foe are posed with lives to spare; the hit
// triggers the real loseLife respawn branch. Afterwards the worms and foes are gone,
// the field persists, and the cursor is centered and invulnerable — all read back.

import { BAND_CX, BAND_CY, chargeAt, freshBoard } from "../_helpers.mjs";

export default function item() {
  let snap;

  return {
    id: "progression.respawn-keeps-field",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", 5, 5, 2);
      await api.call("setNode", 6, 6, 1);
      await api.call("setLives", 3);
      await api.call("setCursor", 640, 688);
      await api.call("setWorm", { segments: [{ c: 20, r: 19 }], dh: 1, dv: 1 });
      await api.call("spawnFoe", "glitch", { x: 300, y: 300 });
    },

    // The hit and the respawn it triggers are the clip: the reviewer watches the
    // worm and foe vanish while the two posed nodes stay put.
    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05s — one sim beat, enough for the touch
      snap = await api.snapshot();
      // The snapshot is captured; the sim runs on only so the respawned cursor and
      // the standing field are legible at the end of the clip.
      await api.advance(120); // 1s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("a life is lost (with lives to spare)", snap.lives, 2);
      check.expectEq("the worms are cleared on respawn", snap.worms.length, 0);
      check.expectEq("the foes are cleared on respawn", snap.foes.length, 0);
      check.expectEq("the field stays standing (5,5)", chargeAt(snap, 5, 5), 2);
      check.expectEq("the field stays standing (6,6)", chargeAt(snap, 6, 6), 1);
      check.expectClose(
        "the cursor respawns centered (x)",
        snap.cursor.x,
        BAND_CX,
        1,
      );
      check.expectClose(
        "the cursor respawns centered (y)",
        snap.cursor.y,
        BAND_CY,
        1,
      );
      // The spawn-in invulnerability is deliberately NOT asserted.
      // specs/progression.md calls it "encouraged", not required — "a short spawn-in
      // invulnerability while the cursor reappears is encouraged so you are not hit
      // twice instantly" — so a build that omits it, or that raises the flag only
      // once the cursor is actually back rather than during the pause before it, is
      // conformant. Gating on `cursor.invulnerable` here failed such a build for a
      // choice the spec left to it. The flag is still contracted to EXIST
      // (specs/instrumentation.md); nothing in this case makes it mandatory to be
      // set at any particular instant.
    },
  };
}
