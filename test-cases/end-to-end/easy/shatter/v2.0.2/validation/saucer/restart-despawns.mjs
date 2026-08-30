// Automated validation for the Saucer item `restart-despawns`: restarting from the
// pause menu begins a new game, and a saucer that was on the field when the game was
// restarted does not survive into it.
//
// `specs/ui.md` puts `RESTART` on the pause menu and `specs/hazards.md` fixes when a
// saucer may be up — "the first appears about 18 seconds into a game" — so a new game
// begins clear of saucers however the previous one ended. A saucer left flying across
// the restart is one the new game never spawned.
//
// A driven game with one saucer crossing it is the precondition (`arrange`), and
// everything the item grades is the behavior, so it all lives in `act`: the saucer flies
// for a beat, the game is paused, `RESTART` is confirmed, and the new game runs on. That
// is also what makes the clip legible — the saucer is on screen before the restart, the
// pause menu shows which entry is taken, and the field plays on without it afterwards.
//
// THE SAUCER IS READ AT THE PAUSE AS WELL AS AFTER THE RESTART. A saucer's visit is
// about twelve seconds (`specs/hazards.md`), so one that left of its own accord would
// leave an empty field that looks exactly like a restart having cleared it. Reading it
// still up the instant the game is paused is what makes its absence afterwards the
// restart's doing, and it is what the item would otherwise pass for vacuously.
//
// The life count is spent for the same reason. `specs/gameplay.md` fixes a new game at
// three ships, but a game that merely RESUMED has three as well unless one has been
// spent first — so the scenario poses a game already down to two, and the count reading
// three afterwards is what separates a restart from a resume.

import {
  SAUCER_CRUISE,
  TICK,
  arrangeBystanderRock,
  newGame,
  ticks,
} from "../_helpers.mjs";

// The pause menu's entries in the order `specs/ui.md` lists them, so `RESTART` is
// entry 1. What the spec does not fix is which entry the menu OPENS on, which is why
// the selection below is driven to this index rather than assumed to be one press away.
const PAUSE_RESTART = 1;

// Where the saucer is posed: left of centre and well above the star's row, so its
// crossing at cruise is clear of the star (which it steers around) and stays on screen
// for the whole beat before the pause.
const SAUCER_START = { x: 300, y: 200 };

/**
 * Move the highlighted menu entry to `target` with the real Up/Down bindings
 * (`specs/gameplay.md`), and report where the selection ended up.
 *
 * The selection is READ and then driven, rather than pressed a fixed number of times:
 * the order of the pause entries is the spec's, but which one is highlighted when the
 * menu opens is the build's, and a build that opens on `RESTART` would have one Down
 * press land on `QUIT TO MENU`. The caller asserts where this landed, so a build whose
 * menu keys move nothing fails on that assertion rather than spinning here.
 *
 * Every press is instant and the game is paused throughout, so nothing here races the
 * record pass's clock: there is no simulation running for a press to land on the wrong
 * side of.
 */
async function selectMenuEntry(api, target, maxPresses = 6) {
  let index = (await api.snapshot()).menuIndex;
  for (let i = 0; i < maxPresses && index !== target; i += 1) {
    await api.call("press", index < target ? "ArrowDown" : "ArrowUp");
    const moved = (await api.snapshot()).menuIndex;
    if (moved === index) break; // the selection did not move; report what was reached
    index = moved;
  }
  return index;
}

export default function item() {
  // The state at each beat of the drive, read by `assert`.
  let before;
  let paused;
  let menuEntry;
  let restarted;
  let settled;

  return {
    id: "saucer.restart-despawns",

    async arrange(api) {
      await newGame(api);
      // One Large rock parked out of every lane this item drives, so the cleared field
      // is not a cleared WAVE: without it the build is entitled to raise its next-wave
      // banner and spawn five rocks partway through the beat being filmed.
      await arrangeBystanderRock(api);
      await api.call("setLives", 2); // a game in progress, one ship already lost
      await api.call("spawnSaucer");
      await api.call("setSaucer", {
        x: SAUCER_START.x,
        y: SAUCER_START.y,
        vx: SAUCER_CRUISE,
        vy: 0,
      });
    },

    async act(api) {
      before = await api.snapshot();

      // Let the saucer cross for a beat, so the clip opens on the field the restart is
      // about to clear rather than on the restart itself.
      await api.advance(ticks(1.5));

      await api.call("press", "Escape"); // pause (specs/gameplay.md)
      paused = await api.snapshot();

      menuEntry = await selectMenuEntry(api, PAUSE_RESTART);
      // Hold on the menu so a reviewer can read which entry is confirmed. The game is
      // paused, so this advances the recording and nothing else.
      await api.advance(ticks(0.8));

      await api.call("press", "Enter"); // confirm RESTART
      // One tick — the smallest amount the debug API can express. A menu confirm is
      // applied on the press (`specs/instrumentation.md`), but a build may latch it and
      // begin the new game on the next fixed step, and both are the same restart.
      await api.advance(TICK);
      restarted = await api.snapshot();

      // Play the new game on, so the clip shows a field that STAYS clear of saucers
      // instead of cutting on the frame the old one went.
      await api.advance(ticks(2));
      settled = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "the game is in play before the restart",
        before.screen,
        "playing",
      );
      check.expectOk("a saucer is on the field", Boolean(before.saucer));
      check.expectEq("Esc pauses the game", paused.screen, "paused");
      check.expectOk(
        "the saucer is still on the field when the game is paused",
        Boolean(paused.saucer),
      );
      check.expectEq(
        "the pause menu reaches its restart entry",
        menuEntry,
        PAUSE_RESTART,
      );
      check.expectEq(
        "confirming RESTART returns to a live game",
        restarted.screen,
        "playing",
      );
      check.expectEq(
        "the restart begins a new game, with all three ships back",
        restarted.lives,
        3,
      );
      check.expectEq("the restart clears the saucer", restarted.saucer, null);
      check.expectEq(
        "the new game is still clear of saucers two seconds in",
        settled.saucer,
        null,
      );
    },
  };
}
