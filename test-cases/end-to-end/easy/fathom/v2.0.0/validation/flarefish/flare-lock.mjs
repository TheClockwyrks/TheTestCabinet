// flarefish.flare-lock: the flare locks onto the forager anywhere in the bloom, at any
// moment, ignoring walls.
//
// Where the forager has to stand is not known until the bloom is burning (it is chosen
// relative to where the Flarefish has wandered to), so `arrange` sweeps to a bloom that
// offers such a spot and `act` is the pose and the lock that follows. Posing there uses
// `setForager`, a control op — `reset` would take the clock back and freeze the clip.
//
// WAIT FOR THE BLOOM, NOT THE CHARGE. This item used to pose the forager the moment the
// Flarefish began CHARGING, and then wait up to a second and a half for the lock. That
// looks reasonable and is not: the charge-up runs about half a second, the Flarefish is
// wandering the whole time at `116 px/s`, and the disc is stuck to the Flarefish, not to
// where it stood when the glow started. A forager posed `114 px` away at the charge can
// therefore be `202 px` away — outside the `192 px` bloom — by the time the bloom
// actually burns, and a build that implements the lock exactly as specified never
// acquires it. That is a failure invented entirely by the scenario. The spec's lock is
// "at any moment while the bloom burns", so the honest scenario is to wait for the bloom
// itself, place the forager inside the disc as it stands THEN, and read the lock right
// away — which is also the only reading that cannot be gamed by drift.
//
// The approach to the flare is skipped rather than filmed: a Flarefish flares about
// every `7 s`, and seven seconds of a parked forager in the dark is the whole clip
// budget spent before anything happens.
import {
  FLARE_RADIUS,
  TICK,
  denAllExcept,
  findFarTile,
  losClear,
  openTiles,
  pred,
  quietBoard,
  startPlaying,
  tileCenter,
  ticksFor,
} from "../_helpers.mjs";

// An open tile inside the burning bloom of `tile` whose line of sight to it is BLOCKED —
// so a lock there proves the flare ignores walls. `reach` is how far into the disc the
// tile may sit: kept well inside the bloom's own radius so the Flarefish's continued
// drift cannot carry the forager out of the light between the pose and the read.
function blindNear(snap, tile, reach) {
  const a = tileCenter(snap.grid, tile.tx, tile.ty);
  for (const [c, r] of openTiles(snap)) {
    const man = Math.abs(c - tile.tx) + Math.abs(r - tile.ty);
    if (man < 3 || man > 6) continue;
    const p = tileCenter(snap.grid, c, r);
    if (Math.hypot(p.x - a.x, p.y - a.y) > reach) continue;
    if (!losClear(snap, c, r, tile.tx, tile.ty)) return { tx: c, ty: r };
  }
  return null;
}

export default function item() {
  let bloom;
  let spot;
  let locked;

  return {
    id: "flarefish.flare-lock",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["flarefish"]);
      const far = findFarTile(snap, snap.forager, 8, {
        // "Far" here means OUTSIDE the bloom, which is a euclidean radius — a
        // manhattan-8 tile can sit at 181 px, inside it. One tile of margin past
        // FLARE_RADIUS so a Flarefish that has drifted a little is still clear.
        minPx: FLARE_RADIUS + snap.grid.tile,
      });
      await api.call("setPredator", "flarefish", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await quietBoard(api);
      // Instant in both passes: travel the several seconds to a flare — and, if need be,
      // past it to the next one — without filming any of it, so the clip opens on a
      // burning bloom rather than on six seconds of dark.
      //
      // WHY THE SEARCH LIVES IN THE SWEEP. A blind tile inside the disc is a property of
      // where the Flarefish happens to be standing, and it wanders, so one particular
      // bloom in one particular maze may offer none. Testing for it on every sample means
      // the scenario simply waits for a bloom that does — over a handful of flares, and
      // dozens of positions within each, rather than staking the item on the first
      // instant it looked. A build whose Flarefish never blooms anywhere useful in
      // 45 s reports that plainly instead.
      bloom = await api.skipUntil(
        (s) => {
          const p = pred(s, "flarefish");
          if (!p.flaring) return false;
          // The disc the build reports; the spec's radius if it reports none. Four
          // fifths of it is margin enough — the lock is read a tick or two after the
          // pose (poll TICK), which is a couple of px of drift, not tens.
          const radius = p.flareRadius > 0 ? p.flareRadius : FLARE_RADIUS;
          const cand = blindNear(s, { tx: p.tx, ty: p.ty }, radius * 0.8);
          if (!cand) return false;
          spot = cand;
          return true;
        },
        { max: ticksFor(45), poll: 4 },
      );
    },

    async act(api) {
      if (!bloom.hit) return;
      await api.call("setForager", spot); // inside the burning bloom, wall between
      // The lock is evaluated as the bloom burns, so a conforming build acquires on the
      // next tick; poll at TICK so the read lands there and the Flarefish cannot drift
      // away underneath it. Half a second is well inside the remaining bloom.
      locked = await api.until((s) => pred(s, "flarefish").state === "chase", {
        max: ticksFor(0.5),
        poll: TICK,
      });
      await api.advance(120); // 1 s of the chase it just began, for the clip
    },

    async assert(api, check) {
      check.expectOk(
        "the Flarefish blooms somewhere with rock between it and an open tile inside the disc",
        bloom.hit,
      );
      if (!bloom.hit) return;
      check.expectOk(
        "the flare locks on through the wall (it chases)",
        locked.hit,
      );
      check.expectOk(
        "the detection alert fires on the flare-lock",
        pred(locked.snap, "flarefish").alert === true,
      );
    },
  };
}
