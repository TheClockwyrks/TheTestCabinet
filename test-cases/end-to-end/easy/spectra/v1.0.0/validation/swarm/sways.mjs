// Automated validation for the Swarm sub-item `sways`.
//
// The formation drifts side to side as one rigid body: every slotted drone rides the
// same horizontal sinusoid, amplitude 20 px and period 5 s, so each one swings 40 px
// from peak to trough and they all do it together (`specs/playfield.md`). Several
// drones are posed into formation and the real sway is swept for a whole period,
// reading each drone's ABSOLUTE x as it goes; the swing is the spread of one drone's
// own x over the sweep, and the rigidity is whether every drone's displacement
// matches at every instant.
//
// Two things this deliberately does NOT do, both of which the old script did:
//
//   * Read the offset as `x - slotX`. `specs/instrumentation.md` calls `slotX` "its
//     resting formation slot" and stops there — it never says whether that slot is
//     the fixed grid position the sway moves the drone AROUND, or the position the
//     slot has been swayed to. Both are honest readings, and a build taking the
//     second reports `x - slotX` as 0 forever while swaying perfectly. Absolute x
//     needs no such ruling.
//   * Sample at a fixed instant on the assumption the wave starts at phase 0 (the
//     peak at 1.25 s, the trough at 3.75 s). The spec fixes the amplitude and the
//     period, not where in the cycle a wave begins, so those instants are one
//     build's choice. Sweeping a full period finds the extremes wherever they fall.

import {
  startStageClean,
  spawnDrone,
  SWAY_SWING,
  SWAY_PERIOD_TICKS,
} from "../_helpers.mjs";

// A sample every 10 ticks over a full period: 61 reads, and near an extreme the
// sinusoid is flat enough that landing up to 5 ticks off it costs under 0.03 px.
const POLL_TICKS = 10;

// Let the posed drones take up the sway before the first sample. Posing sets a
// drone's x directly, and until a tick has run that x is whatever was posed rather
// than a point on the build's sinusoid — a first sample taken there would sit off
// the curve and widen the measured swing for a build whose phase is not 0 at
// wave start.
const SETTLE_TICKS = 2;

// Nine drones across the formation's width. The assault starts peeling drones into
// real dives about 2 s in and takes another every 1.4 s to 2.6 s
// (`specs/drones.md`), so a five-second sweep costs two or three of them; a drone
// that leaves formation is dropped from the reading rather than measured mid-dive,
// and nine is enough that the rigid-body claim still rests on a handful of drones
// at the end of it.
const SPAWN_XS = [384, 448, 512, 576, 640, 704, 768, 832, 896];

// Enough lives that a diver reaching the ship cannot end the run mid-sweep: the
// wave has to keep running for the whole period, and a game-over would freeze the
// sway at whatever phase it had reached.
const LIVES = 9;

/** Every drone currently sitting in formation, as `{ id, x }`. */
function formation(snap) {
  return snap.drones
    .filter((d) => d.phase === "formation")
    .map((d) => ({ id: d.id, x: d.x }));
}

const spread = (xs) => Math.max(...xs) - Math.min(...xs);

export default function item() {
  // One entry per sample: the formation's drones and their x at that instant.
  const sweep = [];

  return {
    id: "swarm.sways",

    async arrange(api) {
      await startStageClean(api, 1); // a real stage 1 wave, field cleared to pose into
      await api.call("setLives", LIVES);
      for (const x of SPAWN_XS) {
        await spawnDrone(api, {
          kind: "shard",
          band: "cyan",
          x,
          y: 200,
          phase: "formation",
        });
      }
    },

    // A full period of the sway — the motion under test, and a clip in which a
    // reviewer watches the whole block drift one way and back as a single body.
    async act(api) {
      await api.advance(SETTLE_TICKS);
      sweep.push(formation(await api.snapshot()));
      for (let spent = 0; spent < SWAY_PERIOD_TICKS; spent += POLL_TICKS) {
        await api.advance(POLL_TICKS);
        sweep.push(formation(await api.snapshot()));
      }
    },

    async assert(api, check) {
      // Only drones that stayed in formation for the WHOLE sweep can be read: one
      // that dove and came back has an x that owes nothing to the sway.
      const held = sweep.reduce(
        (ids, sample) => ids.filter((id) => sample.some((d) => d.id === id)),
        sweep[0]?.map((d) => d.id) ?? [],
      );
      check.expectGt(
        "several drones hold formation across the whole sway",
        held.length,
        1,
      );
      if (held.length < 2) return;

      // Each held drone's own displacement from where it started, per sample.
      const xAt = (sample, id) => sample.find((d) => d.id === id).x;
      const start = new Map(held.map((id) => [id, xAt(sweep[0], id)]));
      const tracks = held.map((id) =>
        sweep.map((sample) => xAt(sample, id) - start.get(id)),
      );

      // The swing: peak to trough over one full period is twice the amplitude,
      // whatever phase the wave happened to start on. Read the SMALLEST swing any
      // held drone managed, so one drone cannot carry the claim for the rest.
      check.expectClose(
        "every held drone swings the full peak-to-trough width",
        Math.min(...tracks.map(spread)),
        SWAY_SWING,
        1.5,
      );

      // Rigid body: at every instant of the sweep, every held drone has moved by the
      // same amount. A formation that swayed per-drone (each on its own phase, or
      // scaled by column) would drift apart here while still swinging 40 px each.
      const drift = Math.max(
        ...sweep.map((_, s) => spread(tracks.map((t) => t[s]))),
      );
      check.expectLt("the drones sway together as one rigid body", drift, 0.5);

      // The period: half a cycle separates the extremes, so the peak and the trough
      // of a one-period sweep sit 2.5 s apart wherever in the cycle the sweep began.
      // This is what stops a build swaying the right 40 px on the wrong clock — half
      // the period, or twice it — from passing on the swing alone.
      const track = tracks[0];
      const iMax = track.indexOf(Math.max(...track));
      const iMin = track.indexOf(Math.min(...track));
      check.expectClose(
        "peak and trough are half a sway period apart",
        Math.abs(iMax - iMin) * POLL_TICKS,
        SWAY_PERIOD_TICKS / 2,
        POLL_TICKS * 2,
      );
    },
  };
}
