// Automated validation for controls.manual-clock: once `reset()` has handed the clock to
// the driver, the game holds still between steps. `specs/instrumentation.md` puts this
// flatly — "`reset()` and `step(ticks)` turn `autoStep` off, beginning a driver-clocked
// session. While it is off, `step(ticks)` is the only thing that advances the simulation,
// so a stepped scenario is exact and reproducible regardless of machine load: no stray
// wall-clock frames can slip into a measurement window" — and it names what may not
// disturb it: "Injecting input (`keyDown`, `keyUp`, `press`) and the other control
// operations do not change `autoStep`."
//
// This is the exact converse of `controls/advances-in-real-time`, which checks the clock a
// build BOOTS with (`autoStep` on, so a player sees a living reef). Together they pin both
// states: the game runs itself for a player, and stops dead for a driver.
//
// WHY IT IS WORTH ITS OWN ITEM. Nothing else can report this. Every other scripted item
// poses a scenario and then measures it, and a build that keeps running through the pose
// simply arrives at the measurement in a different world than the one the check set up —
// so the item that fails is whichever one happened to be posed on something that moved.
// A run failed `controls/move-down` and `controls/wasd-down` because the forager had swum
// off the tile with the opening in it, and `audio/eat` because the pellet under the
// forager had already been eaten, cue and all, before the measurement window opened. None
// of those three items is about the clock, and each named a mechanic the build had
// implemented correctly. Worse, the same build passes or fails them on how fast the host
// answering the driver's calls happens to be. This item is where that defect belongs, so a
// reviewer reading a red line sees the cause rather than three misattributed symptoms.
//
// WHY THE MEASUREMENT LIVES IN `arrange`. The runtime sets the clock explicitly between
// `arrange` and `act` (`setAutoStep(mode === RECORD)`), on the assumption this item
// checks — that the build's own `reset` already armed manual stepping. After that call the
// flag is right whatever the build did with it, and the defect is invisible. So the whole
// measurement is `arrange`, and `act` is only a beat for the record pass to replay.
//
// WHY STILLS RATHER THAN A CLIP, as in `controls/advances-in-real-time`: the record pass
// turns `autoStep` ON for `act`, so a filmed `act` moves either way. A pair of stills that
// a reviewer can see are the SAME picture is what this item has to show.
//
// WHICH IS WHY THE SCENE IS SET UP FOR THE CAMERA. Fathom draws only what the forager's
// light falls on, so a still taken wherever the dive happens to start is a black frame with
// a speck in it — two of those prove nothing to a reader either way. So the forager is
// stood at the head of a straight corridor facing down it with its light opened right up:
// a build that holds still shows the same lit pocket twice, and one that does not shows the
// forager somewhere else down the corridor, more maze revealed behind it, and a score that
// has gone up as it grazed the pellets on the way.
//
// TWO WITNESSES, because a build may legitimately move either or neither. The predators
// patrol on the game's own clock whatever the player does, and a forager with no key held
// keeps swimming under one reading of `specs/movement.md` and rests under the other — so
// whichever of them a build animates, the larger movement is the one that answers this.
// With the clock properly held, both are zero.
import {
  findStraightRun,
  startPlaying,
  unmetPrecondition,
} from "../_helpers.mjs";

// One second of real time with nothing stepping the build. A game still running its own
// clock covers 120 ticks of simulation and carries its predators most of two tiles in
// that; a driver-clocked one does not move at all.
const SETTLE_MS = 1000;

// How much simulation time may still accrue, in seconds. A conforming build advances
// exactly none — the flag gates the animation loop's stepping — so this is not tolerance
// for a different reading of the rule. It is room for a single frame that was already in
// flight when `reset` flipped the flag, which is two ticks at most and nothing a
// measurement window would notice. A build that ignores the flag reports ~1.0 here.
const MAX_DRIFT = 2 / 120;

// How far the furthest-moving character may drift, in logical px, over the same second.
// The forager runs at 128 px/s and the predators patrol at 64-116, so a running clock
// carries the slowest of them 64 px; this is rounding.
const MAX_TRAVEL = 4;

// The step that proves the clock is the DRIVER'S rather than simply stopped. Without it a
// build that never advances under any circumstances — frozen for players too — would clear
// the item on the strength of holding still, which is the one thing it does do.
const PROOF_TICKS = 60;
const MIN_PROOF = PROOF_TICKS / 120 / 2;

export default function item() {
  let drift;
  let travelled;
  let stepped;

  return {
    id: "controls.manual-clock",

    async arrange(api) {
      // `reset()` is the call under test: per the spec it re-arms manual stepping, and the
      // two control ops that follow must leave it that way.
      const opening = await startPlaying(api);
      if (opening.screen !== "playing" || !(opening.predators || []).length) {
        throw unmetPrecondition(
          `the dive is not live with a predator on the reef (screen ${opening.screen}, ` +
            `${(opening.predators || []).length} predator(s)), so there is nothing that ` +
            `would move if the clock were still running`,
        );
      }
      // Set the shot up: a corridor to swim down and the light to see it by, so the pair
      // of stills is a picture a reviewer can read. Control ops only — none of them
      // touches `autoStep` (specs/instrumentation.md).
      const run = findStraightRun(opening, 3);
      await api.call("setForager", { tx: run.tx, ty: run.ty, dir: run.dir });
      await api.call("setBrightness", 1);

      const before = await api.snapshot();
      const movers0 = [before.forager, ...(before.predators || [])];
      await api.screenshot("before");

      // The measurement: real wall-clock time, with nothing stepping the build. `settle`
      // pauses for paint and moves no simulation of its own, in either pass.
      await api.settle(SETTLE_MS);

      const after = await api.snapshot();
      const movers1 = [after.forager, ...(after.predators || [])];
      drift = after.simTime - before.simTime;
      travelled = movers0.reduce(
        (worst, m, i) =>
          movers1[i]
            ? Math.max(
                worst,
                Math.hypot(movers1[i].x - m.x, movers1[i].y - m.y),
              )
            : worst,
        0,
      );
      await api.screenshot("after");

      // And now the positive control, in the same breath: the driver's own step still
      // moves it.
      const beforeStep = await api.snapshot();
      await api.skip(PROOF_TICKS);
      stepped = (await api.snapshot()).simTime - beforeStep.simTime;
    },

    async act(api) {
      await api.advance(120); // a beat so the record pass has an `act` to replay
    },

    async assert(api, check) {
      check.expectLe(
        "no simulation time accrues while the driver holds the clock",
        drift,
        MAX_DRIFT,
      );
      check.expectLe(
        "...and nothing on the reef swam, so it really was held rather than a counter stalled",
        travelled,
        MAX_TRAVEL,
      );
      check.expectGt(
        "and the driver's own step still advances it — held, not frozen",
        stepped,
        MIN_PROOF,
      );
    },
  };
}
