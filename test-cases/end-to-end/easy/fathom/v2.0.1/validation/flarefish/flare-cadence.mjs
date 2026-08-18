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
//
// WHY THE FORAGER KEEPS STEPPING ASIDE. Two consecutive flares take the better part of
// twenty seconds, and the Flarefish must stay in its wander for all of it: the spec has
// it stop flaring the moment it acquires the forager ("while chasing it stops flaring"),
// so a scenario that lets it find the forager has nothing left to time. Parking the
// forager far away does not buy that. The maze is a fixed `36 x 18` tiles — `1152 px`
// across (`specs/maze.md`) — and the Flarefish wanders it at `116 px/s`, so it crosses
// the whole board in about five seconds and covers three board-widths in the time this
// item needs; and its two senses reach a long way, `192 px` for the wall-ignoring bloom
// and `R = 128 + 192 G` for the ordinary light-sense. Wherever the forager is parked, the
// wander arrives. It did: a build failed this item's precondition — and then caught the
// forager, which re-dens every predator — with its cadence textbook.
//
// So the forager is not merely placed out of the way, it is KEPT out of the way. It sits
// at `G = 0`, the floor of the light-sense range, and whenever the wander closes to within
// KEEP_CLEAR it is re-posed to the tile furthest from the Flarefish, by the same
// `setForager` op `arrange` parked it with. Nothing touches the Flarefish, its state, or
// its flare timer — the forager is a bystander in this item, and this only keeps it one.
// What remains is the question the item is named for: with nothing to chase, does it
// flare, and does the next flare come about `7 s` later.
import {
  FLARE_RADIUS,
  boardDisturbance,
  denAllExcept,
  findRemotestTile,
  parkForager,
  pred,
  quietBoard,
  startPlaying,
  stepTile,
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

// How close the wander may come to the parked forager before it steps aside: the bloom's
// own `192 px` radius, which is the longer of the Flarefish's two reaches, plus three
// tiles of margin. The margin covers the ground it can cover between two reads (`116 px/s`
// over GUARD_POLL is `29 px`) many times over, so it is never already inside the radius by
// the time the scenario looks.
const KEEP_CLEAR = FLARE_RADIUS + 96;

// How often the sweeps read the board, in ticks: a quarter of a second. Fine enough that
// neither the `1 s` bloom nor a `2 s` chase-and-give-up can pass between two reads, and
// coarse enough that the measured gap is quantized by `0.25 s` against a `± 2.5 s` band.
const GUARD_POLL = 30;

// How many times the Flarefish is re-posed and the walk to its first flare restarted when
// the wander finds the forager anyway. Only the walk-up is retried; the timed gap is not.
const SWEEP_ATTEMPTS = 3;

// How long a wandering Flarefish is given to flare, in seconds — for the first flare, and
// then for the one that ends the gap. Both are comfortably past the widest reading of the
// cadence (`GAP_TARGET + GAP_SLACK`, 10.5 s), so a build that simply flares slower than
// the spec allows runs the window out and FAILS rather than being reported inconclusive;
// the first is the more generous of the two because a Flarefish posed out of the den may
// be anywhere in its cycle.
const FIRST_FLARE_MAX = 20;
const GAP_MAX = 13;

/** The Flarefish's straight-line distance to the forager, in px. */
function separation(snap) {
  const p = pred(snap, "flarefish");
  if (!p) return Infinity;
  return Math.hypot(p.x - snap.forager.x, p.y - snap.forager.y);
}

/**
 * The forager's home tile and its four neighbors — where `quietBoard` left the single
 * plankton it did not strip. The forager must never be re-posed onto that pellet: eating
 * it clears the maze and descends, which re-dens every predator mid-measurement.
 * `poseLastPlankton` promises only "an open tile adjacent to the forager"
 * (`specs/instrumentation.md`) and `snapshot` does not report plankton, so the whole
 * neighborhood is what a scenario can name.
 */
function pelletZone(snap, home) {
  const zone = new Set([`${home.tx},${home.ty}`]);
  for (const dir of ["up", "down", "left", "right"]) {
    const [c, r] = stepTile(snap, home.tx, home.ty, dir);
    zone.add(`${c},${r}`);
  }
  return zone;
}

/**
 * Move the forager to the tile furthest from where the Flarefish is now, and park it
 * facing rock there so it stays put. Best effort — no `minPx` floor — so it always takes
 * the roomiest tile the maze offers rather than turning a berth into a verdict.
 */
async function stepAside(api, snap, zone) {
  const p = pred(snap, "flarefish");
  const away = findRemotestTile(
    snap,
    { tx: p.tx, ty: p.ty },
    { exclude: (c, r) => zone.has(`${c},${r}`) },
  );
  return parkForager(api, away);
}

/**
 * Sweep to `predicate`, stepping the forager aside whenever the Flarefish closes on it.
 *
 * `live` picks the clock: `false` uses `skip`, which is instant in both passes (the walk
 * up to the first flare, which belongs in `arrange` and out of the clip); `true` uses
 * `advance`, which is real time in the record pass, for the gap that is the measurement.
 * Returns `until`'s shape — `{ snap, hit, spent }`.
 */
async function watch(api, predicate, { max, live, zone }) {
  let snap = await api.snapshot();
  if (predicate(snap)) return { snap, hit: true, spent: 0 };
  for (let spent = 0; spent < max; spent += GUARD_POLL) {
    if (live) await api.advance(GUARD_POLL);
    else await api.skip(GUARD_POLL);
    snap = await api.snapshot();
    if (predicate(snap)) return { snap, hit: true, spent: spent + GUARD_POLL };
    if (separation(snap) < KEEP_CLEAR) snap = await stepAside(api, snap, zone);
  }
  return { snap, hit: false, spent: max };
}

export default function item() {
  let first;
  let second;
  let quiet;
  let zone;
  let flared = false;

  return {
    id: "flarefish.flare-cadence",

    // The gap being timed is most of a flare cycle, and the clip is that gap ending on
    // the bloom; the default 8 s budget would cut off just before the moment it exists
    // to show.
    clipMs: 11000,

    async arrange(api) {
      await startPlaying(api);
      quiet = await denAllExcept(api, ["flarefish"]);
      // The floor of the light-sense range, `R = 128 px`: the forager is a bystander
      // here, so it gives off as little as the spec lets it (`G = 0` is where a dive
      // starts anyway) and only the bloom's radius decides how wide a berth it needs.
      await api.call("setBrightness", 0);
      const home = await quietBoard(api);
      zone = pelletZone(home, home.forager);

      // The walk up to a flare, restarted from a fresh far tile if the wander finds the
      // forager despite the berth. Re-posing costs the item nothing: what is timed is the
      // gap between two flares that come AFTER this, so an interrupted walk-up is simply
      // a walk-up that has to be taken again.
      for (let attempt = 0; attempt < SWEEP_ATTEMPTS; attempt++) {
        const now = await api.snapshot();
        const far = findRemotestTile(now, now.forager, {
          exclude: (c, r) => zone.has(`${c},${r}`),
          minPx: FLARE_RADIUS + 128, // 320 px: the bloom, and four tiles it has to cross
        });
        await api.call("setPredator", "flarefish", {
          tx: far.tx,
          ty: far.ty,
          mode: "wander",
        });
        first = await watch(
          api,
          (s) => {
            const p = pred(s, "flarefish");
            return p.flaring === true || p.state !== "wander";
          },
          { max: ticksFor(FIRST_FLARE_MAX), zone },
        );
        flared = first.hit && pred(first.snap, "flarefish").flaring === true;
        if (flared || !first.hit) break;
      }

      if (first.hit && !flared) {
        // Every attempt, and each time something pulled it out of its wander before it
        // flared. Say what — a posed-den predator loose, a life lost — rather than
        // reporting the Flarefish for it.
        const disturbed = boardDisturbance(first.snap, quiet);
        throw unmetPrecondition(
          disturbed
            ? `${disturbed}, so the Flarefish never got to a flare to time from`
            : `the Flarefish left its wander (${pred(first.snap, "flarefish").state}) ` +
                `before flaring, in ${SWEEP_ATTEMPTS} attempts, so there was no flare to time from`,
        );
      }
      if (!flared) return; // never flared at all: the assertion below is the verdict

      // Out the far side of the bloom, instantly and unfilmed, so `act` begins in the
      // quiet that the next flare ends.
      const out = await watch(
        api,
        (s) => pred(s, "flarefish").flaring === false,
        {
          max: ticksFor(5),
          zone,
        },
      );
      // And one last unconditional step aside, so the gap opens on the widest berth the
      // maze has to give. The forager stepping out of the way is not interesting footage,
      // and this is the one move that can be made before the camera starts.
      await stepAside(api, out.snap, zone);
    },

    async act(api) {
      if (!flared) return;
      // Watch out the gap for the next bloom — or for the Flarefish being pulled out of
      // its wander, which ends the flare cycle by design ("while chasing it stops
      // flaring", specs/predators.md) and leaves nothing to time.
      second = await watch(
        api,
        (s) => {
          const p = pred(s, "flarefish");
          return p.flaring === true || p.state !== "wander";
        },
        { max: ticksFor(GAP_MAX), live: true, zone },
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
            : // It reached the forager between two reads despite the berth it is given.
              // A property of where this build's maze and RNG sent its wander, not of its
              // flare timing.
              `the Flarefish left its wander (${p.state}) before flaring again, so there was no second flare to time`,
        );
      }
      await api.advance(60); // 60 ticks = half a second of the bloom, for the clip
    },

    async assert(api, check) {
      check.expectOk(
        `the Flarefish flares while wandering, within ${FIRST_FLARE_MAX} s`,
        flared,
      );
      if (!flared) return;
      check.expectGt(
        "the bloom has a positive radius",
        pred(first.snap, "flarefish").flareRadius,
        0,
      );
      check.expectOk(
        `it flares again, within ${GAP_MAX} s`,
        Boolean(second?.hit),
      );
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
