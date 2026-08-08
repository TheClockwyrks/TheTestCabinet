// Automated validation for controls.advances-in-real-time: during normal play the game runs
// itself. The animation loop drives the fixed tick from the wall clock
// (`specs/instrumentation.md`), so the wave flies — the drones advance — with nothing stepping it.
//
// WHY THIS ITEM EXISTS. Every other scripted item advances the simulation itself, through the
// runtime's `advance`/`until`/`skip`, which all bottom out in the debug API's `step`. That makes
// them blind to this claim: a build whose own frame loop never runs still answers `step` perfectly
// and passes them all, while a person who opens it sees a frozen field. The spec puts the manual
// clock behind an `autoStep` flag that `reset` and `step` turn OFF, so a build that calls its own
// `reset` on the boot path ships with the flag off and never advances for a player.
//
// WHY THE MEASUREMENT LIVES IN `arrange`. Catching that means observing the clock the build BOOTS
// with, and the window is narrow: `api.reset` hands the clock back by forcing `setAutoStep(true)`,
// `api.skip` does the same, and the runtime sets the flag explicitly between `arrange` and `act`.
// So everything here is `arrange`, poses with CONTROL OPS ONLY — no reset, no step, no skip — and
// measures real elapsed time with `api.settle`, which is genuinely wall-clock in both passes. Do
// not rewrite this onto a helper that opens with a reset; that would mask the defect it hunts.
//
// WHY STILLS RATHER THAN A CLIP. The record pass turns `autoStep` ON for `act`, so a filmed `act`
// animates even for a build that boots frozen — the video would show the very motion the item says
// is missing. Two stills taken around the settle show it honestly. The record pass opens a fresh
// page, so its `arrange` sees the boot clock too.
//
// THE WITNESS IS A DRONE, NOT THE SHIP. The ship is the player's and holds its lane position
// unless a key is pressed. The drones fly their own approach, so they are what moves when — and
// only when — the game is running itself. Drones are tracked by their stable `id`
// (`specs/instrumentation.md`), because the wave keeps spawning across the window and an index
// into the list is not the same drone at both ends of it.
//
// WHY A DRONE IS POSED RATHER THAN WAITED FOR. `startGame` enters the stage's live wave, but the
// wave's own drones arrive on the build's spawn cadence — and because the boot clock is already
// running, how many are on the field the instant after the call is a race. Measured against the
// reference it came back sometimes three, sometimes none. An empty field would report as an unmet
// PRECONDITION, which is precisely the wrong answer for a frozen build: it spawns nothing either,
// so the defect would read as inconclusive rather than failed. `spawnDrone` is a control op: it
// lands a drone instantly, on a frozen build as readily as on a live one, so the field is never
// empty and the only question left is whether anything on it then moves.
//
// WHY THE DIVE IS STARTED WITH `forceDive` RATHER THAN POSED. The drone used to be posed straight
// into `phase: "diving"`, which asks a build to invent a dive for a drone that never launched
// one. `specs/instrumentation.md` gives `forceDive` for exactly this — it "sends the drone from
// its slot into a real dive now, routing through the same dive-launch code the assault uses" —
// and a build that reasonably treats a hand-posed `diving` drone as having no path yet left it
// sitting still, so this item reported a frozen game for a build whose wave was visibly flying.
// Posed into its slot and then given a real dive, the witness moves on any build that is running.
//
// AND THE WITNESS IS THE WHOLE FIELD, NOT ONE DRONE. The travel read is the FURTHEST any drone
// moved, matched by id across the window — the posed diver plus whatever the build's own wave is
// already flying. The claim is "the game advances itself", so any drone moving proves it, and
// resting the verdict on one drone made the item fragile to that drone in particular. A stopped
// build still reports zero: nothing on its field moves at all.

// Two seconds of real time, which carries an approaching drone a clear distance down the field.
const SETTLE_MS = 2000;
// Half the settle. Deliberately generous: the claim is that the game advances ITSELF, not that it
// keeps perfect time, and a build that clamps its per-frame delta (ordinary spiral-of-death
// protection) legally loses time to a stall. A running build lands near 2.0; a frozen one reports 0.
const MIN_ADVANCE = SETTLE_MS / 1000 / 2;
// The floor the tracked drone must travel, in logical px. A second, independent witness: it says
// the SIMULATION ran, not merely that a counter ticked up.
const MIN_TRAVEL = 20;
// A beat so the record pass has an `act` to replay; the verdict is already fixed by `arrange`.
const TAIL_TICKS = 120;

/**
 * Mark an unmet precondition — the build answered every debug call correctly, but the scenario
 * did not take, so there is nothing to grade. A plain property rather than a shared class because
 * this file is loaded by path and cannot import the runtime's (see `PRECONDITION_UNMET` in
 * `packages/browser-driver/validation.mjs`).
 */
function unmetPrecondition(reason) {
  const err = new Error(reason);
  err.ttcPreconditionUnmet = true;
  return err;
}

export default function item() {
  let advanced;
  let travelled;

  return {
    id: "controls.advances-in-real-time",

    async arrange(api) {
      // Control ops only, and never `api.reset` — see the header. `startGame` enters the first
      // stage's live wave directly (`specs/instrumentation.md`), and the posed drone guarantees
      // the field is occupied whatever the wave's own cadence has managed by now.
      await api.call("startGame");
      // Posed into a formation slot with explicit coordinates, then sent into a REAL dive.
      // Measured against the reference over this window, a drone holding formation drifts 11 px
      // on the swarm's sway while a diving one crosses 414 px — so a dive is what tells a running
      // game from a stopped one with room to spare, and the drift is much too close to the floor
      // to rest a verdict on. Leaving the coordinates out gets whatever the build defaults to,
      // which on the reference was no position at all (a non-numeric x/y, and a NaN
      // displacement); 640,160 is mid-field, inside the play area's 64..656 band.
      const diveId = await api.call("spawnDrone", {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 160,
        slotX: 640,
        slotY: 160,
        phase: "formation",
      });
      await api.call("forceDive", diveId);

      const before = await api.snapshot();
      if (!(before.drones || []).some((d) => d.id === diveId)) {
        throw unmetPrecondition(
          `the posed drone is not on the field after starting the run (screen ${before.screen}, ` +
            `${(before.drones || []).length} drone(s)), so there is nothing flying to observe`,
        );
      }
      const was = new Map((before.drones || []).map((d) => [d.id, d]));
      await api.screenshot("before");

      // The measurement: real wall-clock time, with nothing driving the build but its own loop.
      await api.settle(SETTLE_MS);

      const after = await api.snapshot();
      advanced = after.simTime - before.simTime;

      // The furthest ANY drone travelled, matched by id. A drone that left the field (flew off,
      // or reached the ship) is gone from the list, which is itself proof the simulation ran: a
      // stopped game can no more remove a drone than move one.
      const survivors = new Set((after.drones || []).map((d) => d.id));
      if ([...was.keys()].some((id) => !survivors.has(id))) {
        travelled = Infinity;
      } else {
        travelled = 0;
        for (const d of after.drones || []) {
          const d0 = was.get(d.id);
          if (!d0) continue; // spawned during the window: no start point to measure from
          const moved = Math.hypot(d.x - d0.x, d.y - d0.y);
          // Unusable coordinates read as no motion rather than poisoning the max.
          if (Number.isFinite(moved)) travelled = Math.max(travelled, moved);
        }
      }
      await api.screenshot("after");
    },

    async act(api) {
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectGt(
        "the simulation clock advanced on the build's own frame loop, with nothing stepping it",
        advanced,
        MIN_ADVANCE,
      );
      check.expectGt(
        "...and a drone actually flew, so the simulation ran rather than a counter ticking",
        travelled,
        MIN_TRAVEL,
      );
    },
  };
}
