// Automated validation for the Targeting sub-item `fire-rate`.
//
// "Each emitter fires at its fire rate (shots/second) whenever it has a target"
// (specs/towers.md, shared targeting rules), and the rate is one of the stat numbers
// that file says to "implement exactly as written". An Arc is 2.0 shots/s, so its
// shots fall half a second apart for as long as something is in range.
//
// The check is built around what an emitter does when a target arrives AFTER a quiet
// spell, because that is where a plausible implementation goes wrong and an ordinary
// one does not notice. A build that runs its shot timer down every step — including
// the steps it has nothing to shoot at — banks the whole idle stretch and spends it
// the instant a unit walks in, discharging one shot per TICK until the debt is paid.
// That is not a cosmetic fault: the burst carries the tower up its own heat ramp in a
// few frames, so a gun the player left covering a quiet lane empties itself and trips
// the moment the wave arrives. Between waves is the game's normal resting state
// (specs/gameplay.md), so this is the common case, not a corner one.
//
// TWO READINGS, BECAUSE THE TOTAL ALONE CANNOT SEE IT. Counting shots over a window
// looks like the obvious test and quietly lets the burst through: a bursting Arc fires
// its banked shots, drives itself to 100 and trips, and then fires nothing at all
// while it cools — landing on a three-second total that a correctly-paced Arc would
// also produce. What separates them is not how many shots but how close together, so
// the smallest gap between consecutive shots is read as well. A conformant build
// cannot put two shots inside one interval; a bursting one puts eight inside eight
// ticks.
//
// Shots are counted as increases in the tower's own lifetime `damageDealt`
// (specs/instrumentation.md), not from the per-step `firing` flag. One Arc and one
// Core on the floor means every increase is one shot of this tower's, and a counter
// the build maintains for its own inspector is harder to be accidentally right about
// than a flag sampled at the right instant.

import {
  newGame,
  buildVentCorridor,
  spawn,
  tower,
  actTail,
  CORRIDOR_WALLS,
  TICK,
  TICK_HZ,
} from "../_helpers.mjs";

// The Arc's published rate, and the interval that follows from it (specs/towers.md).
const ARC_RATE = 2.0;
const ARC_INTERVAL = TICK_HZ / ARC_RATE; // 30 ticks between shots

// The window shots are counted over, measured from the first one, and how many a
// 2.0/s emitter fires in it: the opening shot plus one per interval after it.
const WINDOW = 3 * TICK_HZ; // 180 ticks — 3 s
const EXPECTED = 1 + WINDOW / ARC_INTERVAL; // 7

// How far the count may sit from that. One shot of slack, which is what the window's
// own edge is worth — a build whose interval lands a fraction late puts its last shot
// outside the window — and far tighter than the burst it has to separate.
const COUNT_SLACK = 1;

// The floor under the smallest gap between consecutive shots. Four fifths of the
// published interval: loose enough for a build that accumulates its timer in floating
// point and lands a tick or two early, nowhere near loose enough to admit a second
// shot inside the same interval.
const MIN_GAP = 0.8 * ARC_INTERVAL; // 24 ticks

// How long the Arc is left with nothing to shoot at before its target arrives. Four
// seconds is eight shots' worth of an Arc's rate — enough that a build banking its
// idle time has an unmistakable debt to discharge — and it is skipped rather than
// advanced, so the clip opens on the Core arriving rather than on an empty floor.
const IDLE = 4 * TICK_HZ; // 240 ticks

export default function item() {
  let walls;
  let shotTicks = [];

  return {
    id: "targeting.fire-rate",

    // Three seconds of firing plus the tail, and nothing else is filmed: the idle
    // stretch is skipped and the Core is in range as soon as it is spawned.
    clipMs: 6000,

    // An Arc in a vent corridor with an empty floor, posed cold and then left to sit.
    // Cold matters twice over: `heatMultiplier` is lowest there, so the Core takes the
    // longest possible time to die, and it leaves the whole ramp between the Arc and
    // its own trip, so a correctly-paced Arc cannot reach 100 inside the window and
    // stop firing for a reason this item would misread.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const corridor = await buildVentCorridor(api, "arc");
      walls = corridor.walls;
      await api.call("setHeat", corridor.id, 0);
      // The quiet spell, run through the real simulation but not filmed.
      await api.skip(IDLE);
    },

    // Give the Arc its target and watch every tick. The sweep runs to the end of the
    // window rather than stopping at a verdict — the gaps between the shots ARE the
    // measurement, so all of them have to be seen.
    async act(api) {
      const arc = (await api.snapshot()).towers.find((t) => t.type === "arc");
      await spawn(api, "core", "left");

      let dealt = arc.damageDealt;
      let firstShot = null;
      for (let tick = 0; ; tick += 1) {
        await api.advance(TICK);
        const t = await tower(api, arc.id);
        if (t.damageDealt > dealt) {
          if (firstShot === null) firstShot = tick;
          shotTicks.push(tick);
        }
        dealt = t.damageDealt;
        if (firstShot !== null && tick >= firstShot + WINDOW) break;
        // A build that never fires at all must not hang the sweep: 8 s is well past
        // the point where a working Arc has taken its first shot at a unit standing
        // in its range.
        if (firstShot === null && tick > 8 * TICK_HZ) break;
      }
      await actTail(api); // hold on the Arc and the Core it is grinding down
    },

    async assert(api, check) {
      // A hole in the corridor lets the Core walk round the Arc, and a shot count of
      // zero would then be about the scenery rather than about the rate.
      check.expectEq("the vent corridor was built", walls, CORRIDOR_WALLS);
      // Hard: with no shots there is no cadence to measure and both readings below
      // would be vacuously true of a gun that never fired.
      check.assertOk(
        "the Arc fired on the Core in its range",
        shotTicks.length > 0,
      );

      check.expectClose(
        `an Arc fires ${ARC_RATE}/s — its shots over 3 s`,
        shotTicks.length,
        EXPECTED,
        COUNT_SLACK,
      );

      // The reading the burst cannot survive. With one shot there is no gap to take,
      // and the count assertion above has already failed that build.
      const gaps = shotTicks.slice(1).map((tick, i) => tick - shotTicks[i]);
      check.expectGe(
        "consecutive shots stay a full firing interval apart (ticks)",
        gaps.length ? Math.min(...gaps) : ARC_INTERVAL,
        MIN_GAP,
      );
    },
  };
}
