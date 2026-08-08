// Automated validation for controls.advances-in-real-time: during normal play the game runs
// itself — the animation loop drives the fixed tick from the wall clock
// (`specs/instrumentation.md`), so the field moves with nothing stepping it.
//
// Every other item advances the simulation through `advance`/`until`/`skip`, which bottom out in
// the debug API's `step`, so all of them pass a build whose own frame loop never runs. This one
// must therefore observe the clock the build BOOTS with: everything lives in `arrange`, poses with
// CONTROL OPS ONLY — no `reset`, `step` or `skip`, each of which hands the clock back — and times
// the window with `api.settle`, which is real in both passes. Do not rewrite it onto a helper that
// opens with a reset. The outputs are stills for the same reason: the record pass turns `autoStep`
// on for `act`, so a filmed `act` animates even for a build that boots frozen.
//
// `simTime` alone would pass a build whose loop only ticks a counter, so the item also measures
// distance — the furthest of the coasting ship and the drifting rocks. Either carries the verdict,
// since a build may legitimately open play on a `WAVE 1` banner with an empty field
// (`validation/waves/banner.mjs`) or ignore `setShip`'s velocity.

// The measurement window and the floors it must clear. `MIN_ADVANCE` is half the window: the claim
// is that the game advances ITSELF, not that it keeps perfect time, and a build that clamps its
// per-frame delta legally loses some. A running build lands near 2.0; a frozen one reports 0.
const SETTLE_MS = 2000;
const MIN_ADVANCE = SETTLE_MS / 1000 / 2;
const MIN_TRAVEL = 20; // logical px, whatever moved furthest

// How long to let an opening banner run before measuring anyway; `specs/gameplay.md` puts it at
// about 1.5 s.
const WAVE_WAIT_MS = 4000;
const POLL_MS = 100;

// Parked lower-left heading right: clear of the star's core, and about 320 px of coast once the
// spec's drag is applied, with no screen edge crossed to muddle the reading.
const SHIP_POSE = { x: 140, y: 650, vx: 200, vy: 0, angle: 0 };

// The ship's grace is CLEARED so it renders solidly in both stills — builds blink an invulnerable
// ship, and one may open play with a starting grace running, which leaves the ship missing from
// the very frames that are the evidence. It costs nothing: a rock may then kill it, but a death
// needs collisions to have run, so the respawn jump proves what the coast would have.
const INVULN_S = 0;

// A beat so the record pass has an `act` to replay; the verdict is fixed by `arrange`.
const TAIL_TICKS = 120;

/**
 * Mark an unmet precondition. A plain property rather than a shared class because this file is
 * loaded by path (see `PRECONDITION_UNMET` in `packages/browser-driver/validation.mjs`).
 */
function unmetPrecondition(reason) {
  const err = new Error(reason);
  err.ttcPreconditionUnmet = true;
  return err;
}

/** Wait in REAL time for `predicate` — `api.until` in the one shape `arrange` allows. */
async function settleUntil(api, predicate, { max, poll }) {
  let snap = await api.snapshot();
  if (predicate(snap)) return snap;
  for (let waited = 0; waited < max; waited += poll) {
    await api.settle(poll);
    snap = await api.snapshot();
    if (predicate(snap)) return snap;
  }
  return snap;
}

/** How far a body moved between two readings. */
function moved(before, after) {
  if (!before || !after) return 0;
  return Math.hypot(after.x - before.x, after.y - before.y);
}

/**
 * The furthest any rock moved between two readings. The whole field rather than one rock: a rock
 * that wraps an edge reads as an enormous jump and a destroyed one vanishes, so the largest
 * displacement is the stable reading either way.
 */
function furthestDrift(before, after) {
  let furthest = 0;
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i += 1) {
    furthest = Math.max(furthest, moved(before[i], after[i]));
  }
  return furthest;
}

export default function item() {
  let advanced;
  let travelled;

  return {
    id: "controls.advances-in-real-time",

    async arrange(api) {
      await api.call("startGame"); // enters play; the wave follows, at once or after a banner

      const opened = await api.snapshot();
      if (opened.screen !== "playing") {
        throw unmetPrecondition(
          `startGame did not enter play (screen ${opened.screen}), so there is no live field to ` +
            `observe`,
        );
      }

      // Let any opening banner run, so the stills show a field with rocks on it.
      await settleUntil(api, (s) => (s.rocks || []).length > 0, {
        max: WAVE_WAIT_MS,
        poll: POLL_MS,
      });

      // Posed last, so the coast belongs to the measurement window rather than the wait above.
      await api.call("setInvuln", INVULN_S);
      await api.call("setShip", SHIP_POSE);

      const before = await api.snapshot();
      await api.screenshot("before");

      // The measurement: real wall-clock time, with nothing driving the build but its own loop.
      await api.settle(SETTLE_MS);

      const after = await api.snapshot();
      advanced = after.simTime - before.simTime;
      travelled = Math.max(
        moved(before.ship, after.ship),
        furthestDrift(before.rocks || [], after.rocks || []),
      );
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
        "...and the field actually moved with it — the coasting ship, or a drifting rock, " +
          "travelled — so the simulation ran rather than a counter ticking",
        travelled,
        MIN_TRAVEL,
      );
    },
  };
}
