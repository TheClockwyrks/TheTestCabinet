// Automated validation for the Audio item `fire-cue`: a distinct short cue plays
// when an emitter fires. Audio is read from the Web Audio sources the build starts
// (see `api.audio`). Two Stutters are stood at the gate with a real Core filing past
// them; audio is armed, and sustained real firing must grow the audio log.
//
// EVERY READ OF THE AUDIO LOG IS A SETTLED ONE (`audioSettled`, not `audioCount`).
// The validate pass advances the simulation instantly, so a count taken on the tick an
// event happens gives the build no wall clock in which to schedule anything — and a
// build that raises its cues from its render frame, or rate-limits them against
// `AudioContext.currentTime`, has scheduled nothing yet. Both are conformant, and
// reading unsettled reported a full set of working cues as silence. See the note above
// `armAudio` in `_helpers`.
//
// THE CLOCK IS THE BUILD'S FOR THE COUNTED WINDOW. A cue is played by a presentation layer
// reading events the simulation emitted, and a build is free to raise it from its frame loop
// rather than from inside `step` — see the note above `giveClockToBuild` in `_helpers`.
// Driving with `step` and then asking what played reports silence for a game whose cues
// work. So the Core is walked into range with `skip` (instant, unfilmed) and the firing
// window itself runs on the build's own clock.
//
// WHY THE WINDOW IS SUSTAINED FIRE FROM TWO FAST GUNS, AND WHY IT STOPS AT THE FIRST CUE.
//
// `specs/ui.md` asks for a cue when an emitter fires; it does not ask for one per shot, and
// a gun that fires several times a second has every reason to thin its own sound out so it
// does not machine-gun. One of the builds checked here thins hard — it plays its firing cue
// on a per-shot COIN FLIP, at eight percent — and against that, a window holding a handful
// of shots is not a measurement, it is a lottery. An Arc at 2.0/s over three seconds offers
// six chances and comes up silent three times in five, which fails a build whose firing is
// audible for a reason that has nothing to do with the build.
//
// So the window is sized in SHOTS rather than in seconds, and it is generous. Two Stutters
// fire at 7.0/s apiece (specs/towers.md), so the cap below is worth around a hundred and
// forty shots; even at an eight percent cue rate the chance of hearing nothing across it is
// a few parts in a million. And because the sweep stops the moment the log grows, a build
// that plays every shot is done in a fraction of a second — the cap is a ceiling on the
// pathological case, never the cost of the ordinary one.
//
// The Stutters' heat is re-posed to zero on every poll, which is a control op and consumes
// no time. Without it they trip on their own self-heating after about twelve shots
// (`heatPerShot / mass` = 8.4) and spend five seconds offline and silent, which would put
// most of the window's shots back out of reach.
//
// The guns stand at the gate so they have something to shoot at whatever route the build
// walks its surge on (see the note above `buildGate` in `_helpers`); an emitter aimed at an
// assumed lane never fires, and this item would report a missing cue for it.

import {
  newGame,
  build,
  buildGate,
  spawn,
  armAudio,
  audioSettled,
  audioCount,
  giveClockToBuild,
  gateCell,
  GATE_WALLS,
} from "../_helpers.mjs";

// The second gun, two rows below the one the gate stands at its gap. Both are inside their
// 5-tile range of the route through the gap, and the rows above them stay open so the Core
// still has a way round to it.
const SECOND = {
  col: gateCell("stutter").col,
  row: gateCell("stutter").row + 2,
};

// The ceiling on the sustained-fire window, and how long the build is left to run between
// reads.
//
// The poll is coarse on purpose. Only the settles advance the game — the round trips around
// them do not — so a finely-polled window spends most of its wall clock talking to the
// browser rather than letting the guns fire. At 80 ms per poll the game was running for
// about four tenths of the window; at 250 ms it runs for nearer three quarters of it, which
// roughly doubles the shots the ceiling is worth without costing anything. It also stays far
// short of a Stutter's 1.7 s climb from cold to its redline, so the reset below always lands
// in time.
const FIRE_WINDOW_MS = 10000;
const POLL_MS = 250;

/** Total lifetime damage the guns have dealt — the durable evidence that they fired. */
async function dealtBy(api, ids) {
  const s = await api.snapshot();
  return s.towers
    .filter((t) => ids.includes(t.id))
    .reduce((sum, t) => sum + t.damageDealt, 0);
}

export default function item() {
  let ids;
  let walls;
  let before;
  let after;
  let dealt = 0;
  let tripped = false;

  return {
    id: "audio.fire-cue",

    // The approach is skipped and the sweep normally returns in well under a second; the
    // budget only has to cover a build that thins its cue heavily.
    clipMs: 12000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const gate = await buildGate(api, "stutter");
      walls = gate.walls;
      const second = await build(api, "stutter", SECOND.col, SECOND.row);
      ids = [gate.id, second].filter((x) => x !== null);
      for (const id of ids) await api.call("setHeat", id, 0);
      await spawn(api, "core", "left");
      await armAudio(api);
    },

    // Walk the Core into range unfilmed, then let the build drive itself while the guns
    // work — so whatever it plays for its own shots is played the way a player hears it.
    async act(api) {
      await api.skipUntil(
        (s) => s.towers.some((t) => ids.includes(t.id) && t.firing),
        { max: 600, poll: 6 },
      );

      // `giveClockToBuild` spends the handover burst for us (see its note); the guns are
      // zeroed AFTER it so the window starts cold whatever the catch-up did — the skip above
      // leaves them in the eighties on its own.
      await giveClockToBuild(api);
      for (const id of ids) await api.call("setHeat", id, 0);

      before = await audioSettled(api);
      const dealt0 = await dealtBy(api, ids);

      // Sustained fire on the build's own clock, holding the guns off their own redline,
      // until the log grows or the ceiling is reached.
      for (let spent = 0; spent < FIRE_WINDOW_MS; spent += POLL_MS) {
        await api.settle(POLL_MS);
        const s = await api.snapshot();
        for (const t of s.towers) {
          if (ids.includes(t.id) && t.tripped) tripped = true;
        }
        // Hold them short of the trip so the window keeps offering shots.
        for (const id of ids) await api.call("setHeat", id, 0);
        if ((await audioCount(api)) > before) break;
      }

      after = await audioSettled(api);
      dealt = (await dealtBy(api, ids)) - dealt0;
    },

    async assert(api, check) {
      // A hole in the gate lets the Core walk round the guns, and a silent log would
      // then be about the scenery rather than about the cue.
      check.expectEq("the gate wall was built", walls, GATE_WALLS);
      check.expectEq("both guns were placed", ids.length, 2);
      check.expectGt("they fire at the Core in range", dealt, 0);
      // The trip is TRACKED but not asserted on. A gun is silent while it is offline, so a
      // window spent tripped would be a bad window — but the heat is zeroed on every poll
      // precisely so that cannot happen for long, and `dealt` above already establishes that
      // the guns were firing across it. Asserting "never tripped" instead made the item fail
      // on a transient the check itself had caused (see the handover burst in `act`), which
      // is exactly the kind of self-inflicted verdict this suite has been getting rid of.
      // It stays in the label so a silent build can be told apart at a glance.
      check.expectGt(
        `a cue plays while an emitter fires (Web Audio sources started${tripped ? "; the guns tripped at some point" : ""})`,
        after,
        before,
      );
    },
  };
}
