// Automated validation for controls.advances-in-real-time: during normal play the game runs
// itself. The animation loop drives the fixed tick from the wall clock
// (`specs/instrumentation.md`), so a surge unit walks the floor with nothing stepping it.
//
// WHY THIS ITEM EXISTS. Every other scripted item advances the simulation itself, through the
// runtime's `advance`/`until`/`skip`, which all bottom out in the debug API's `step`. That makes
// them blind to this claim: a build whose own frame loop never runs still answers `step` perfectly
// and passes them all, while a person who opens it sees a frozen floor.
//
// THE MATCH IS REACHED THROUGH THE MENUS, WITH REAL KEY EVENTS, AND THAT IS THE WHOLE POINT.
//
// This used to open the match with the debug `startGame`, on the reasoning that it is a control op
// and control ops only pose the world. That reasoning has a hole in it, and a build fell straight
// through: `specs/instrumentation.md` names exactly two operations that hand the clock to manual
// stepping — "`reset` and `step` already switch to manual on their own" — and a build whose
// `startGame` ALSO switches to manual is then frozen for this check and nobody else. Its menus set
// the clock running as they always did, so a person plays it perfectly happily; only a caller who
// entered through the debug door saw a dead floor. The item reported "the game does not advance
// itself" about a game that advances itself, which is the one thing it must never do.
//
// The fix is not to special-case that op but to stop using the debug door at all. What this point
// scores is a claim about the game a PERSON opens, so the check now opens it the way a person
// does: genuine browser-trusted key events (`api.userKey`, the same primitive `armAudio` uses for
// the autoplay gesture) through the build's own menu handling — title, mode, difficulty — until the
// match is live. Nothing here calls `reset`, `startGame`, `step` or `skip`, so the clock under
// observation is the one a player gets, arrived at by the route a player takes.
//
// That also keeps the original hunt intact. A build whose frame loop genuinely never runs still
// fails: the menus respond to input events directly, so it will reach "playing" and then sit there
// with its simulation stopped, which is exactly what the settle below measures. What no longer
// fails is a build that is merely fussy about which door you came in by.
//
// TWO WITNESSES, MEASURED SEPARATELY. The clock is read first, across a settle that follows the
// menu navigation and NOTHING else — so no control op stands between reaching the match and
// observing it, and the reading cannot be blamed on one. Only then are a wave and a unit posed for
// the second witness, which says the SIMULATION ran rather than a counter ticking up. Keeping them
// apart means a build that freezes on some later op fails the second and passes the first, which
// points at the op instead of at the clock.
//
// WHY THE UNIT IS SPAWNED RATHER THAN WAITED FOR. `startWave` does release a wave, but the spawn
// cadence is the build's own, so "a unit had appeared within two seconds" would pin a free choice
// — and worse, a frozen build spawns nothing, which would report as an unmet PRECONDITION rather
// than the failure it is. `spawnUnit` is a control op: it lands a unit instantly, on a frozen
// build as readily as on a live one, so the only thing left to observe is whether it then moves.
//
// WHY STILLS RATHER THAN A CLIP. The record pass turns `autoStep` ON for `act`, so a filmed `act`
// animates even for a build that sits frozen here — the video would show the very motion the item
// says is missing. Two stills taken around the settle show it honestly. The record pass opens a
// fresh page, so its `arrange` walks the menus and sees the same clock.

// Real time per measurement window. A Mote covers 60 px/s (`specs/surge.md`), so the pair of
// stills shows it a clear distance further along the floor.
const SETTLE_MS = 1500;
// Half the settle. Deliberately generous: the claim is that the game advances ITSELF, not that it
// keeps perfect time, and a build that clamps its per-frame delta (ordinary spiral-of-death
// protection) legally loses time to a stall. A running build lands near 1.5; a frozen one reports 0.
const MIN_ADVANCE = SETTLE_MS / 1000 / 2;
// The floor the unit must travel, in logical px. A Mote covers 60 px/s, so even a clock managing a
// fifth of real time carries it past this. A second, independent witness: it says the SIMULATION
// ran, not merely that a counter ticked up.
const MIN_TRAVEL = 20;
// How many menu confirmations to try before giving up. The longest path a player takes is title ->
// mode select -> difficulty select -> playing, so three; the rest is slack for a build that opens
// on a splash, or that needs backing out of How to play.
const MENU_STEPS = 8;
// A beat so the record pass has an `act` to replay; the verdict is already fixed by `arrange`.
const TAIL_TICKS = 60;

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

const unitById = (s, id) => (s.surge || []).find((u) => u.id === id) ?? null;

/**
 * A real key event, and then a moment for the build to act on it.
 *
 * `api.userKey` returns as soon as Chromium has dispatched the event, which is not the same
 * instant the game has read it: a build is free to queue input and drain the queue once per
 * animation frame, decoupled from the event itself, and the reference does exactly that. Reading
 * the snapshot straight after a press therefore sees the state BEFORE the press on such a build —
 * which had this helper pressing Enter a second time at what it thought was the same screen, and
 * walking the menus out of step with themselves. A short settle is what a real keyboard has and an
 * injected one does not: the gap between keystrokes.
 */
const FRAME_MS = 60; // ~4 frames at 60 Hz

/**
 * Drive the menus to a live match with real key events, as a player would.
 *
 * `specs/controls.md` requires the keyboard alternative on every menu — "`Enter` confirms a focused
 * item and `Esc` goes back" — so this needs nothing a conformant build does not have. It confirms
 * the FIRST entry at each screen, which `specs/ui.md` fixes as PLAY at the title; further down the
 * order is the build's own, and it does not matter here, because every route through mode and
 * difficulty select ends in a live match and any live match answers this item's question.
 *
 * The highlight is moved by pressing ArrowUp exactly `menuIndex` times, which lands on the first
 * entry whether the build clamps at the end of its list or wraps around it.
 *
 * After each confirmation the screen is polled until it changes, rather than assumed to have
 * changed — see `FRAME_MS`.
 */
async function playThroughMenus(api) {
  for (let step = 0; step < MENU_STEPS; step += 1) {
    const s = await api.snapshot();
    if (s.screen === "playing") return s;
    if (s.screen === "howto") {
      await api.userKey("Escape");
      await api.settle(FRAME_MS);
      continue;
    }

    const idx = Math.max(0, Math.min(12, Number(s.menuIndex) || 0));
    for (let k = 0; k < idx; k += 1) {
      await api.userKey("ArrowUp");
      await api.settle(FRAME_MS);
    }

    await api.userKey("Enter");
    // Wait for the confirmation to land before deciding what screen we are on.
    for (let poll = 0; poll < 8; poll += 1) {
      await api.settle(FRAME_MS);
      if ((await api.snapshot()).screen !== s.screen) break;
    }
  }
  const s = await api.snapshot();
  return s.screen === "playing" ? s : null;
}

export default function item() {
  let advanced;
  let travelled;

  return {
    id: "controls.advances-in-real-time",

    async arrange(api) {
      // The player's route in. No reset, no startGame, no step, no skip — see the header.
      const live = await playThroughMenus(api);
      if (!live) {
        const s = await api.snapshot();
        throw unmetPrecondition(
          `the menus did not reach a live match by keyboard (stopped on screen ${s.screen}), ` +
            `so there is no running game to observe`,
        );
      }

      // Witness one: the clock, across a settle that follows the menus and nothing else.
      const clock0 = (await api.snapshot()).simTime;
      await api.settle(SETTLE_MS);
      advanced = (await api.snapshot()).simTime - clock0;

      // Witness two: something on the floor actually moving.
      await api.call("startWave"); // put the floor into its wave phase
      const id = await api.call("spawnUnit", "mote", "left");

      const before = await api.snapshot();
      const unit0 = unitById(before, id);
      if (!unit0) {
        throw unmetPrecondition(
          `the spawned Mote is not on the floor (phase ${before.phase}, ` +
            `${(before.surge || []).length} unit(s)), so there is nothing moving to observe`,
        );
      }
      await api.screenshot("before");

      await api.settle(SETTLE_MS);

      const after = await api.snapshot();
      const unit1 = unitById(after, id);
      travelled = unit1 ? Math.hypot(unit1.x - unit0.x, unit1.y - unit0.y) : 0;
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
        "...and the surge unit actually walked, so the simulation ran rather than a counter ticking",
        travelled,
        MIN_TRAVEL,
      );
    },
  };
}
