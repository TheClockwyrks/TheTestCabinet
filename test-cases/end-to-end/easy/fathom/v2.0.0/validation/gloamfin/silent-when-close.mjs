// gloamfin.silent-when-close: while it holds the forager at close hearing range the
// Gloamfin goes silent — it emits no ping until the forager slips back out of range.
//
// The Gloamfin holds a continuous lock straight off its hearing whenever the forager is
// inside its ~2-tile range, and while that lock holds it does not ping — not its ~4 s
// periodic ping and not a "lost you" ping (specs/predators.md). We hold the forager two
// tiles from the Gloamfin (inside hearing) for well past the 4 s ping cadence and confirm
// no ping ever leaves it while `hearingLock` stays true. Both are re-posed to that fixed
// close spot each sweep — that keeps the *precondition* under test (the forager inside
// hearing range) in place without the Gloamfin closing the gap and making contact; the
// suppression itself is the real per-tick sensing code running, never faked. A build that
// still fired the ping (the old spam) would show a Gloamfin pulse and fail.
import {
  startPlaying,
  findSightLine,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

export default function item() {
  let fx;
  let fy;
  let gx;
  let gy;
  let lockedAtStart;
  let lockHeld;
  let pinged;

  return {
    id: "gloamfin.silent-when-close",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 2); // 64 px apart — right at the ~2-tile hearing edge
      // Park the other two predators in the den (denTimer holds them there) so only the
      // Gloamfin is in play.
      await denAllExcept(api, ["gloamfin"]);
      fx = line.forager.tx;
      fy = line.forager.ty;
      gx = line.pred.tx;
      gy = line.pred.ty;
      await api.call("setForager", { tx: fx, ty: fy });
      await api.call("setPredator", "gloamfin", {
        tx: gx,
        ty: gy,
        mode: "chase",
      });
    },

    async act(api) {
      await api.advance(6); // 6 ticks = 0.05 s: let the close-range lock take hold
      lockedAtStart = pred(await api.snapshot(), "gloamfin").hearingLock;

      lockHeld = lockedAtStart === true;
      pinged = false;
      const poll = 6; // 0.05 s sweeps
      const sweeps = Math.ceil(720 / poll); // 720 ticks = 6 s, well past the 4 s ping cadence
      for (let i = 0; i < sweeps; i++) {
        // Re-establish the close configuration (the precondition under test) so the
        // Gloamfin holds the lock without closing in, then step the real sim.
        await api.call("setForager", { tx: fx, ty: fy });
        await api.call("setPredator", "gloamfin", {
          tx: gx,
          ty: gy,
          mode: "chase",
        });
        await api.advance(poll);
        const s = await api.snapshot();
        if (pred(s, "gloamfin").hearingLock !== true) lockHeld = false;
        // Any Gloamfin wavefront in flight means a ping fired — it must not, while the
        // hearing lock holds.
        if (s.pulses.some((p) => p.source === "gloamfin")) pinged = true;
      }
    },

    async assert(api, check) {
      check.expectOk(
        "the Gloamfin holds a continuous close-range hearing lock",
        lockedAtStart === true,
      );
      check.expectOk(
        "it keeps the lock the whole time the forager stays in range",
        lockHeld === true,
      );
      check.expectOk(
        "it emits no ping while it holds the forager at close range (goes silent)",
        pinged === false,
      );
    },
  };
}
