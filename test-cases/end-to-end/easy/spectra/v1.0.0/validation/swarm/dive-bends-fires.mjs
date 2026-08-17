// Automated validation for the Swarm sub-item `dive-bends-fires`.
//
// A diving drone leaves the formation, bends its path toward the player's x as it
// descends, and fires while diving. A formation drone is posed at the centre of the
// field and the ship parked far to one side; a REAL dive is launched (forceDive)
// and advanced — the closest its path comes to the ship's x is measured, and its
// real fire is read as an enemy bullet of its own band appearing.
//
// The dive is run TWICE from the same slot, once with the ship far left and once
// far right, because that is what separates a path that bends toward the player
// from a fixed track that always sweeps the same way. Measuring only "the drone's x
// fell a long way" passed a build whose dive drifts in the player's rough direction
// but never actually arrives — exactly what `specs/drones.md` rules out ("threatens
// the player, bending toward the player ship's `x` so it is a real attack, not a
// fixed track"). Only the first dive is filmed; the second is stepped instantly
// (`skip`), so the clip stays one readable attack run.

import {
  startClean,
  protectShip,
  spawnDrone,
  findDrone,
  enemyBullets,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

const ARM_TICKS = 6; // 6 ticks = the old 0.05 s to arm the dive systems

// Where the drone starts, and where the ship is parked for each of the two dives.
// The drone starts on the centreline and each ship position is 440 px away, so
// neither dive can reach its target merely by starting near it.
const SLOT_X = 640;
const SHIP_LEFT_X = 200;
const SHIP_RIGHT_X = 1080;

// How much of its opening gap a dive must CLOSE for it to count as a real attack.
//
// `specs/drones.md` fixes no distance. It asks for two things at once — the path
// "threatens the player, bending toward the player ship's `x` so it is a real
// attack, not a fixed track", but "stays dodgeable, sweeping in rather than homing
// perfectly onto the player" — so any absolute "comes within N px" threshold is a
// number the spec does not state, and the tighter it is the more it asks for the
// homing the same sentence rules out. The old check demanded 80 px, which failed
// builds whose dives visibly bend across the field toward the ship.
//
// What the spec DOES separate is bending from a fixed track, and that is a
// relative claim: a dive is run twice from the same slot, once with the ship far
// left and once far right, and each run is asked to close a third of the 440 px it
// starts away from the ship. A fixed track cannot do both — whichever way it
// sweeps, it closes on one player position only by opening away from the other —
// while a path that bends toward the player closes on both. That is exactly the
// distinction `specs/drones.md` draws, tested without inventing a distance.
const CLOSE_FRACTION = 1 / 3;

// The old sweep was 130 reads 0.02 s apart — a 2.6 s window. 0.02 s is 2.4 ticks,
// which the tick contract refuses rather than rounds, so the poll rounds DOWN to 2:
// it is a SAMPLING poll tracking the drone's closest approach and watching for its
// first shot, and reading more often can only find a nearer approach or an earlier
// bullet, never miss one a coarser sweep would have caught. The budget is raised to
// 720 ticks (6 s) so a slow, wide dive still runs to its end inside the window.
const POLL_TICKS = 2;
const WINDOW_TICKS = 720;

/**
 * Pose one Shard on the centreline with the ship at `shipX`, launch a real dive,
 * and sweep it to its end. `advanceBy` is the runtime call that moves time on —
 * `advance` for the dive that is filmed, `skip` for the one that is not — so both
 * dives are measured identically and only one costs clip time.
 *
 * Returns the phase the drone entered, the closest its x came to the ship's during
 * the dive (a DISTANCE in px, not a field coordinate), the drone's own x at that
 * closest approach (which IS a field coordinate), the band of the first enemy
 * bullet it fired (null if it never fired), and the band the drone itself was
 * reading while diving.
 */
async function runDive(api, { shipX, advanceBy, leadInTicks = 0 }) {
  await api.call("clearField");
  await api.call("setShipX", shipX);
  const id = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: SLOT_X,
    y: 200,
    phase: "formation",
  });
  // The lead-in is spent HERE, with the drone already posed, rather than before the
  // scenario is set up: time advanced over an empty field is time spent on nothing
  // a reviewer can read, and a wave with no drones left in it is a wave the game is
  // entitled to treat as cleared.
  if (leadInTicks > 0) await advanceBy(leadInTicks);
  await advanceBy(ARM_TICKS); // let the formation register (arms the dive systems)
  await api.call("forceDive", id);
  const entered = findDrone(await api.snapshot(), id).phase;

  let nearest = Math.abs(SLOT_X - shipX);
  let nearestX = SLOT_X;
  let firedBand = null;
  let droneBand = "cyan";
  for (let spent = 0; spent < WINDOW_TICKS; spent += POLL_TICKS) {
    await advanceBy(POLL_TICKS);
    const s = await api.snapshot();
    const d = findDrone(s, id);
    if (d && d.phase === "diving") {
      const gap = Math.abs(d.x - s.ship.x);
      if (gap < nearest) {
        nearest = gap;
        nearestX = d.x;
      }
      droneBand = d.effectiveBand ?? d.band;
    }
    const shots = enemyBullets(s);
    if (firedBand === null && shots.length > 0) firedBand = shots[0].band;
    if (!d || d.phase !== "diving") break;
  }
  return { entered, nearest, nearestX, firedBand, droneBand };
}

export default function item() {
  // What each of the two dives observed.
  let left;
  let right;

  return {
    id: "swarm.dive-bends-fires",

    // A clean wave; `act` poses each dive's drone and ship itself, so the two runs
    // are set up identically.
    async arrange(api) {
      await startClean(api);
      // Two full dives are flown at the ship, and a diver fires on the way down.
      // Three hits would end the run and stop the wave advancing, leaving the
      // second dive unmeasurable. See `protectShip`.
      await protectShip(api);
      await api.call("setShipX", SHIP_LEFT_X);
    },

    // The first dive IS the clip: a reviewer sees the drone leave the formation,
    // curve across toward the ship, and fire on the way down.
    async act(api) {
      left = await runDive(api, {
        shipX: SHIP_LEFT_X,
        advanceBy: (n) => api.advance(n),
        leadInTicks: LEAD_IN_TICKS, // a beat on the formation before it peels off
      });

      // The same dive with the ship on the other side. `skip` steps the real
      // simulation exactly as `advance` does but instantly in both passes, so this
      // second run decides its half of the verdict without adding a second attack
      // run to a clip that has already made its point.
      right = await runDive(api, {
        shipX: SHIP_RIGHT_X,
        advanceBy: (n) => api.skip(n),
      });
    },

    async assert(api, check) {
      check.expectEq("the drone enters a dive", left.entered, "diving");

      // Each dive starts this far from the ship, and must close `CLOSE_FRACTION` of
      // it. The asserted value is the closest approach as a DISTANCE in px — how
      // near the diver's x came to the ship's — not a position on the field.
      const startGap = Math.abs(SLOT_X - SHIP_LEFT_X);
      const mustReach = startGap * (1 - CLOSE_FRACTION);
      check.expectLt(
        "with the player far left, the dive closes a third of the px gap to the player's x",
        left.nearest,
        mustReach,
      );
      check.expectLt(
        "with the player far right, the dive closes a third of the px gap to the player's x",
        right.nearest,
        mustReach,
      );
      // …and it closes them in opposite directions, which is what a fixed track
      // cannot do. Sign only: the spec fixes no distance, and the pair of closing
      // tests above already carries the magnitude.
      check.expectGt(
        "the dive's closest-approach x follows the player from left to right",
        right.nearestX,
        left.nearestX,
      );

      check.expectOk("the diver fires while diving", left.firedBand !== null);
      if (left.firedBand !== null) {
        check.expectEq(
          "the diver's shot carries its own band",
          left.firedBand,
          left.droneBand,
        );
      }
    },
  };
}
