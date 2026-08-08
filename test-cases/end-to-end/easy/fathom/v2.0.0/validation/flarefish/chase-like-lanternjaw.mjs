// flarefish.chase-like-lanternjaw: on acquiring you it stops flaring and chases exactly
// like the Lanternjaw; lose it and the flare re-arms.
//
// The standoff is posed instantly (`arrange`); the acquisition, the ink that breaks it and
// the drop back to wandering all take real time, so they are `act` — the clip is the whole
// fix-then-lose sequence at the game's own speed.
//
// WHY THE FORAGER RETREATS, WHICH IT USED NOT TO. This posed the forager on a sight line
// and PARKED it there for the whole measurement. That works only if losing a fix is
// instantaneous, and it is not: `specs/predators/flarefish.md` has a hunter that has lost
// you path to your last-known tile and linger `2 s` there before giving up, and the
// last-known tile is the one the parked forager is still standing on. So a build that takes
// that reading walks up and takes the life, and the item that was supposed to grade its
// chase-and-lose cycle instead graded how long the forager survived. It now uses the ink
// standoff the two ink items use (`findInkStandoff`), which gives the forager three tiles to
// get clear of its own cloud — the same bounded, pinned retreat, for the same reasons; see
// `flarefish/ink-breaks` for why it is exactly three tiles and why it is parked afterwards.
import {
  DIR_KEY,
  denAllExcept,
  findInkStandoff,
  parkForager,
  pred,
  startPlaying,
  tileGapPx,
  untilGivesUp,
} from "../_helpers.mjs";

export default function item() {
  let line;
  let gap;
  let onFix;
  let lost;

  return {
    id: "flarefish.chase-like-lanternjaw",
    // Room for the walk to the stale fix and the linger it waits out there.
    clipMs: 12000,

    async arrange(api) {
      const snap = await startPlaying(api);
      line = findInkStandoff(snap, { gap: 3 });
      // The ground it has to cover to the tile its fix goes stale on, before the linger
      // can even start running.
      gap = tileGapPx(snap.grid, line.pred, line.ink);
      await denAllExcept(api, ["flarefish"]);
      await api.call("setPredator", "flarefish", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      // Facing the way it will break away, and the board left un-stripped so the swim
      // cannot clear the maze mid-clip.
      await api.call("setForager", {
        tx: line.ink.tx,
        ty: line.ink.ty,
        dir: line.flee,
      });
      await api.call("setBrightness", 1);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      onFix = pred(await api.snapshot(), "flarefish");

      // Lose it with ink; it drops back to wandering (the flare re-arms). How long that
      // takes is a build's own reading — on the instant, or after walking to the stale fix
      // and waiting out its linger — so this waits for either. See `untilGivesUp`.
      await api.call("clearCooldowns");
      await api.call("press", "ShiftLeft");
      await api.call("keyDown", DIR_KEY[line.flee]);
      await api.advance(100); // three tiles: clear of the 80 px cloud, and no further
      await api.call("keyUp", DIR_KEY[line.flee]);
      await parkForager(api);
      lost = await untilGivesUp(api, "flarefish", { pathPx: gap });

      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq("on acquiring, it chases", onFix.state, "chase");
      check.expectOk(
        "it stops flaring while chasing (chases like the Lanternjaw)",
        onFix.flaring === false,
      );
      check.expectOk("losing you returns it to wandering", lost.gaveUp);
    },
  };
}
