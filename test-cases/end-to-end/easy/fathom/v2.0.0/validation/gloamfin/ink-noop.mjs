// gloamfin.ink-noop: ink has no effect on the sound-based Gloamfin; it keeps chasing.
//
// The chase is posed instantly (`arrange`); the ink drop, the forager's break-away and
// the Gloamfin swimming straight through the cloud after it are the real sim, so they are
// `act` and are what the clip shows.
//
// WHAT THE CLIP HAS TO SHOW, AND WHY THAT SHAPES THE SCENARIO. "Ink does nothing to it"
// is an absence, and an absence photographs badly: the old scenario inked on top of a
// parked forager with the Gloamfin two tiles off, so the cloud swallowed both of them and
// the clip was a hunter closing on a stationary forager — indistinguishable from a clip
// with no ink in it at all. Here the forager inks and breaks away, which leaves the cloud
// standing between the two, and the verdict is read at the moment the Gloamfin is INSIDE
// that cloud: the one place a sight-based hunter would have lost the fix, and the one the
// Gloamfin walks through without breaking stride.
//
// The read is taken as it ENTERS the cloud rather than later, which also keeps the check
// honest. Its hearing reaches about two tiles, so a Gloamfin allowed to close on a
// fleeing forager could re-acquire by ear — and a build whose ink DID wrongly break the
// fix would then read as chasing again, passing this item for the opposite reason. At the
// entry instant the two are still four tiles apart, well outside hearing, so the chase
// that is read can only be the one the ink failed to break.
import {
  DIR_KEY,
  GLOAMFIN_HEAR,
  TICK,
  denAllExcept,
  findInkStandoff,
  pred,
  startPlaying,
  ticksFor,
} from "../_helpers.mjs";

export default function item() {
  let line;
  let beforeInk;
  let entered;
  let afterInk;
  let gapAtRead = 0;

  return {
    id: "gloamfin.ink-noop",

    async arrange(api) {
      const snap = await startPlaying(api);
      // gap 3: the Gloamfin starts OUTSIDE the 80 px cloud (96 px away), so the clip
      // shows it entering the ink rather than beginning inside it.
      line = findInkStandoff(snap, { gap: 3 });
      await denAllExcept(api, ["gloamfin"]);
      // The forager first: `chase` fixes on wherever it is standing when the mode is set,
      // and that tile is where the cloud is about to go. Facing the way it will break
      // away, and the board left un-stripped so the swim cannot clear the maze mid-clip.
      await api.call("setForager", {
        tx: line.ink.tx,
        ty: line.ink.ty,
        dir: line.flee,
      });
      await api.call("setPredator", "gloamfin", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        dir: line.flee, // pointed down the corridor at the forager
        mode: "chase",
      });
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      beforeInk = pred(await api.snapshot(), "gloamfin").state;
      await api.call("clearCooldowns");
      await api.call("press", "ShiftLeft"); // ink at the forager, over the line to the Gloamfin
      await api.call("keyDown", DIR_KEY[line.flee]);
      // Read the state the moment the Gloamfin is inside the cloud it is chasing through.
      entered = await api.until(
        (s) =>
          s.inkClouds.some(
            (cloud) =>
              Math.hypot(
                cloud.x - pred(s, "gloamfin").x,
                cloud.y - pred(s, "gloamfin").y,
              ) <= cloud.radius,
          ),
        { max: ticksFor(1), poll: TICK },
      );
      const g = pred(entered.snap, "gloamfin");
      afterInk = g.state;
      gapAtRead = Math.hypot(
        g.x - entered.snap.forager.x,
        g.y - entered.snap.forager.y,
      );
      await api.advance(90); // it crosses the cloud and keeps coming, for the clip
      await api.call("keyUp", DIR_KEY[line.flee]);
      await api.advance(30);
    },

    async assert(api, check) {
      check.expectEq("the Gloamfin is chasing", beforeInk, "chase");
      check.expectOk(
        "the Gloamfin reached the ink cloud between it and the forager",
        entered.hit,
      );
      if (!entered.hit) return;
      check.expectGt(
        "it is still out of hearing range at the read, so only the ink is in question",
        gapAtRead,
        GLOAMFIN_HEAR,
      );
      check.expectEq(
        "ink does not stop the Gloamfin (still chasing, inside the cloud)",
        afterInk,
        "chase",
      );
    },
  };
}
