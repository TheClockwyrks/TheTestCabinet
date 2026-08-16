// Automated validation for progression.respawn-keeps-field: on losing a life with
// lives to spare, the worms and foes clear and the cursor respawns centered and
// briefly invulnerable, while the node field stays standing.
//
// A field, a worm walking the floor row into the cursor, and a foe are posed with
// lives to spare; the touch triggers the real loseLife respawn branch. Afterwards
// the worms and foes are gone, the field persists, and the cursor is back at the
// centre of the band — all read back.
//
// The worm WALKS into the cursor rather than being posed on top of it — see
// `arrangeWormIntoCursor` for why a posed overlap left this deciding on a build's
// choice of when to test for contact rather than on what a respawn keeps. It also
// means the cursor starts OFF the band's centre, so the re-centring below is a
// change the check can actually see rather than a value that was already true.

import {
  BAND_CX,
  BAND_CY,
  actWormReachesCursor,
  arrangeWormIntoCursor,
  chargeAt,
  freshBoard,
} from "../_helpers.mjs";

export default function item() {
  let snap; // the tick the touch landed on
  let respawned; // once the respawn pause has run out

  return {
    id: "progression.respawn-keeps-field",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", 5, 5, 2);
      await api.call("setNode", 6, 6, 1);
      await api.call("setLives", 3); // lives to spare, so the touch respawns
      await arrangeWormIntoCursor(api);
      await api.call("spawnFoe", "glitch", { x: 300, y: 300 });
    },

    // The approach, the touch and the respawn it triggers are the clip: the reviewer
    // watches the worm bear down on the cursor, then the worm and foe vanish while
    // the two posed nodes stay put, and the cursor come back in the middle of the
    // band.
    async act(api) {
      snap = await actWormReachesCursor(api);

      // The board-clearing half is read at the instant of the touch, above; the
      // CURSOR is read here, once the respawn has actually happened. The two are
      // separate moments in specs/progression.md and reading them at one moment gets
      // the second one wrong: "briefly clear the board of the current worm(s) and
      // foes, THEN respawn the cursor centered in the band and spawn the level's
      // worm afresh from the top AFTER A SHORT PAUSE". A build that recentres when
      // the cursor actually reappears is doing exactly that, and sampling its cursor
      // on the tick of the hit reads where the player last left it.
      //
      // (The old item never noticed, because it posed the cursor at the band's
      // centre to begin with: "respawns centered" was already true before the touch,
      // so the assertion passed whether or not the build ever moved it. It is a real
      // check now only because the worm walks into a cursor parked off-centre.)
      const back = await api.until((s) => s.phase === "active", {
        max: 480, // 4s — several times the pause any build here takes
        poll: 6,
      });
      respawned = back.snap;

      // The sim runs on only so the respawned cursor and the standing field are
      // legible at the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("a life is lost (with lives to spare)", snap.lives, 2);
      check.expectEq("the worms are cleared on respawn", snap.worms.length, 0);
      check.expectEq("the foes are cleared on respawn", snap.foes.length, 0);
      check.expectEq("the field stays standing (5,5)", chargeAt(snap, 5, 5), 2);
      check.expectEq("the field stays standing (6,6)", chargeAt(snap, 6, 6), 1);
      check.expectClose(
        "the cursor respawns centered (x)",
        respawned.cursor.x,
        BAND_CX,
        1,
      );
      // The vertical tolerance is looser than the horizontal one, on purpose.
      // specs/progression.md asks for the cursor to respawn "centered in the band"
      // and fixes no number for it. Horizontally that is unambiguous — the band is
      // the full stage width, so its centre is the stage centre, and a pixel of slack
      // is plenty. Vertically the band is two tiles and the cursor's own y is clamped
      // to a 32 px strip inside it, so "centred" is a judgement about a short span,
      // and builds land a pixel or two either side of the exact midpoint by rounding
      // it against a sprite height or a row edge. At +/-1 this failed a build that
      // respawned 2 px low — a difference no reviewer can see and no play can feel —
      // for a precision the spec never asked for. Four pixels is an eighth of the
      // cursor's whole vertical travel: still nowhere near the top or the floor
      // (16 px out), which is what "centred" is actually ruling out.
      check.expectClose(
        "the cursor respawns centered (y)",
        respawned.cursor.y,
        BAND_CY,
        4,
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
