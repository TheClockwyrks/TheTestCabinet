// Automated validation for the Audio item `trip-cue`: a distinct short cue plays when
// a tower trips its redline. Audio is read from the Web Audio sources the build starts
// (see `api.audio`).
//
// THE TOWER HAS TO TRIP THE WAY IT TRIPS IN PLAY.
//
// This item used to box an emitter in movers, pose its heat to exactly 100, and require
// the log to grow. That reads the DEBUG POSE rather than the game's own trip: a build is
// free to have `setHeat` put the tower straight into its cooldown — which is what the
// debug contract asks of it, "the real ... trip ... systems act on that heat"
// (specs/instrumentation.md) — while raising the game's cue from the thermal update that
// a real trip goes through. Two of the four builds this was re-checked against do
// exactly that, and both play a trip cue on every trip a player will ever cause. They
// failed an item about a sound they make.
//
// So the emitter here trips the way `trip.trips-at-100` trips one: it is stood at the
// gate with a real Core to shoot at and posed just under the redline, and its own firing
// carries it over. That is the path a build wires its cue to.
//
// THE CONTROL IS ONE ORDINARY SHOT, BECAUSE THE TRIPPING SHOT IS ALSO A SHOT.
//
// The probe counts sources and cannot say which cue started one, and the step that
// crosses 100 fired first — so the trip window unavoidably contains a firing cue too,
// and "the log grew" is true of a build with a fire cue and no trip cue. Both windows
// are therefore exactly one shot wide, measured off the tower's own `damageDealt`
// (specs/instrumentation.md): the first is a shot with the redline far away, the second
// is the shot that crosses it. What the second has that the first does not is the trip.
//
// Every read of the audio log is a settled one (`audioSettled`, not `audioCount`) — see
// the note above `armAudio` in `_helpers`.

import {
  newGame,
  buildGate,
  spawn,
  tower,
  armAudio,
  audioSettled,
  actTail,
  giveClockToBuild,
  GATE_WALLS,
} from "../_helpers.mjs";

// A LANCE, NOT A STUTTER, BECAUSE THE WINDOWS ARE ONE SHOT WIDE.
//
// Both windows have to hold exactly one shot for the difference between them to be the trip
// and nothing else. That was easy while the sweep stepped a tick at a time; it is not, now
// that the window runs on the build's own clock and is read every 250 ms, because a Stutter
// fires at 7.0/s — nearly two shots inside a single poll. The control window then quietly
// held two or three shots' worth of firing cues, the trip window held one plus the trip, and
// the difference came out at zero on a build whose trip cue works.
//
// A Lance fires at 0.8/s (specs/towers.md), so 1.25 s separates its shots and a 250 ms poll
// cannot contain two of them. It adds `heatPerShot / mass` = 48.9 / 2.8 = 17.5 heat apiece,
// so posing it at 85 puts the trip exactly one shot away, and cold it is nowhere near.
const NEAR_TRIP = 85;
const COLD = 0;

/**
 * Let the build's own clock run until the emitter lands exactly ONE more shot, holding its
 * heat at `hold` until then. Returns `{ shots }`.
 *
 * THE HOLD IS WHAT MAKES THE WINDOW ONE SHOT WIDE. A Lance sheds about 14 heat between its
 * shots at this end of the scale and gains 17.5 from one, so a tower merely posed near the
 * redline creeps toward it over four or five shots rather than crossing on the next — and the
 * window then carries four firing cues that the one-shot control window does not. That
 * difference alone cleared the assertion, so the item passed a build whose trip cue had been
 * deleted outright. Re-posing the heat on every poll cancels the cooling, so the next shot
 * lands on the heat that was asked for and the window closes on it.
 */
async function oneShot(api, id, hold, { maxMs = 10000, stepMs = 150 } = {}) {
  const before = (await tower(api, id)).damageDealt;
  await api.call("setHeat", id, hold);
  for (let spent = 0; spent < maxMs; spent += stepMs) {
    await api.settle(stepMs);
    const t = await tower(api, id);
    if (t && t.damageDealt > before) return { shots: 1 };
    // Hold the posed heat against the tower's own cooling until the shot lands.
    await api.call("setHeat", id, hold);
  }
  return { shots: 0 };
}

export default function item() {
  let id;
  let walls;
  let onShot;
  let onTrip;
  let shots1 = 0;
  let shots2 = 0;
  let tripped;

  return {
    id: "audio.trip-cue",

    // Two one-shot windows, each with a settle either side, plus the tail.
    clipMs: 9000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const gate = await buildGate(api, "lance");
      id = gate.id;
      walls = gate.walls;
      await api.call("setHeat", id, COLD);
      await spawn(api, "core", "left");
      await armAudio(api);
    },

    // Window 1: one ordinary shot, nowhere near the redline. Window 2: the tower posed
    // one shot short of 100, and the shot that takes it over. 600 ticks = a 10 s cap on
    // each; polling every tick keeps each window to the single shot it is about.
    async act(api) {
      await giveClockToBuild(api);

      // Window 1: exactly one shot, from cold.
      const shotBefore = await audioSettled(api);
      const w1 = await oneShot(api, id, COLD);
      onShot = (await audioSettled(api)) - shotBefore;
      shots1 = w1.shots;

      // Window 2: exactly one shot, from one shot short of the redline — so that shot is
      // the one that trips it.
      //
      // THE COUNT IS TAKEN BEFORE THE HEAT IS POSED. `audioSettled` settles a quarter-second
      // before it reads and the build's clock runs through that, which is long enough for a
      // posed tower to fire, cross 100 and play its trip cue INSIDE the baseline reading —
      // swallowing the very cue the window exists to count. `oneShot` poses after the
      // baseline, so the whole trip falls inside the window.
      const tripBefore = await audioSettled(api);
      const w2 = await oneShot(api, id, NEAR_TRIP);
      onTrip = (await audioSettled(api)) - tripBefore;
      shots2 = w2.shots;
      tripped = (await tower(api, id))?.tripped === true;

      await actTail(api); // hold on the tripped tower rather than cutting on it
    },

    async assert(api, check) {
      // A hole in the gate lets the Core walk round the Lance, and a silent log would
      // then be about the scenery rather than about the cue.
      check.expectEq("the gate wall was built", walls, GATE_WALLS);
      // Both windows have to hold the SAME number of shots for the firing cue to cancel
      // between them; one apiece is what makes the difference the trip and nothing else.
      check.expectEq("the control window fired one shot", shots1, 1);
      check.expectEq("the trip window fired one shot too", shots2, 1);
      check.expectOk("and that shot carries it over the redline", tripped);
      check.expectGt(
        "the shot that trips the tower plays more than an ordinary shot (the trip cue)",
        onTrip,
        onShot,
      );
    },
  };
}
