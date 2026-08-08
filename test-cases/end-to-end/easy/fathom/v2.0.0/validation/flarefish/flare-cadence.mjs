// flarefish.flare-cadence: while wandering it flares about every 7 s (a short charge
// then a bloom).
//
// WHAT IS TIMED, AND WHY IT IS NOT THE FIRST FLARE. An earlier form waited for the FIRST
// flare and asserted it arrived at an absolute `simTime` of 7.7 s. That is the reference
// implementation's opening phase, not the spec's requirement: `specs/predators.md` fixes
// the CADENCE ("about every 7 s the Flarefish emits a flare") and the re-arm after a
// chase, and says nothing about how far through its cycle a Flarefish is when a dive
// begins. A build that arms its first flare mid-cycle and then flares on a perfect
// interval is conforming, and the old assertion failed it on the one number the spec
// leaves free. So this times the interval BETWEEN two consecutive flares, which is the
// thing the spec actually names.
//
// The journey to the first flare is `skip`ped in `arrange` — instant in both passes, so
// it costs the verdict nothing and the clip does not open on a wait for a flare that is
// not the one being timed. `act` is the gap itself, ending on the second bloom, which is
// exactly the cadence a reviewer needs to see.
import {
  FLARE_RADIUS,
  boardDisturbance,
  denAllExcept,
  findFarTile,
  pred,
  quietBoard,
  startPlaying,
  ticksFor,
  unmetPrecondition,
} from "../_helpers.mjs";

// The band the measured flare-to-flare gap must fall in.
//
// The spec's `7 s` does not say where the interval is measured from, and the two honest
// readings differ by the flare's own duration: onset-to-onset (7 s) versus the quiet
// between one flare ending and the next beginning, which puts the onsets `7 s` plus the
// charge, bloom and fade apart (about 9 s). Both are "about every 7 s" as written, so the
// band spans both readings with slack for the "about", and still fails a Flarefish that
// strobes every couple of seconds or goes dark for half a minute.
const GAP_TARGET = 8;
const GAP_SLACK = 2.5;

export default function item() {
  let first;
  let second;
  let quiet;

  return {
    id: "flarefish.flare-cadence",

    // The gap being timed is most of a flare cycle, and the clip is that gap ending on
    // the bloom; the default 8 s budget would cut off just before the moment it exists
    // to show.
    clipMs: 11000,

    async arrange(api) {
      const snap = await startPlaying(api);
      quiet = await denAllExcept(api, ["flarefish"]);
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
      // To the first flare and out the far side of it, instantly and unfilmed: the
      // opening phase is not what is being measured, and `act` should begin in the quiet
      // that the next flare ends.
      first = await api.skipUntil(
        (s) => pred(s, "flarefish").flaring === true,
        {
          max: ticksFor(20),
          poll: 6,
        },
      );
      if (first.hit) {
        await api.skipUntil((s) => pred(s, "flarefish").flaring === false, {
          max: ticksFor(5),
          poll: 6,
        });
      }
    },

    async act(api) {
      if (!first.hit) return;
      // Watch out the gap for the next bloom — or for the Flarefish being pulled out of
      // its wander, which ends the flare cycle by design ("while chasing it stops
      // flaring", specs/predators.md) and leaves nothing to time.
      second = await api.until(
        (s) => {
          const p = pred(s, "flarefish");
          return p.flaring === true || p.state !== "wander";
        },
        { max: ticksFor(13), poll: 6 },
      );
      const p = pred(second.snap, "flarefish");
      if (!p.flaring && p.state !== "wander") {
        // Two very different things put the Flarefish somewhere other than its wander,
        // and only one of them is about the Flarefish. Ask what actually happened before
        // reporting: if the rest of the board stopped being quiet — a posed-den predator
        // came out, or the forager was caught and every predator was re-denned — then the
        // scenario broke, not the flare cycle, and saying "the Flarefish left its wander"
        // sends a reader hunting through the wrong code.
        const disturbed = boardDisturbance(second.snap, quiet);
        throw unmetPrecondition(
          disturbed
            ? `${disturbed}, so the Flarefish never got to its second flare and there was nothing to time`
            : // Its own wander carried it onto the forager before the next flare was due. A
              // property of where this build's maze and RNG sent it, not of its flare timing.
              `the Flarefish left its wander (${p.state}) before flaring again, so there was no second flare to time`,
        );
      }
      await api.advance(60); // 60 ticks = half a second of the bloom, for the clip
    },

    async assert(api, check) {
      check.expectOk("the Flarefish flares while wandering", first.hit);
      if (!first.hit) return;
      check.expectGt(
        "the bloom has a positive radius",
        pred(first.snap, "flarefish").flareRadius,
        0,
      );
      check.expectOk("it flares again", Boolean(second?.hit));
      if (!second?.hit) return;
      check.expectClose(
        "consecutive flares come on its ~7 s cadence",
        second.snap.simTime - first.snap.simTime,
        GAP_TARGET,
        GAP_SLACK,
      );
    },
  };
}
