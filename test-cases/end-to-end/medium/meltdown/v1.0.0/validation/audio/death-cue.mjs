// Automated validation for the Audio item `death-cue`: a distinct cue plays when a
// surge unit dies. Audio is read from the Web Audio sources the build starts (see
// `api.audio`).
//
// The probe COUNTS sources; it cannot say which cue started one. A kill is always
// delivered by a shot, and a shot plays the firing cue, so "the log grew while the
// unit was being killed" is true of a build with no death cue at all — the growth is
// the firing. The two events are separated by differencing instead: the same emitter
// fires the SAME NUMBER OF SHOTS in each of two windows, at a target that survives them
// and then at targets that do not. Both windows carry that many firing cues; only the
// second carries deaths, so the death cue is whatever the second window has that the
// first does not.
//
// Counting is what makes the differencing necessary rather than just tidy: a build is
// free to synthesize one cue from several sources (an arpeggio is three), so no fixed
// number of sources means "a cue played" and only a comparison against a matched
// window is sound.
//
// WHY EACH WINDOW IS FOUR SHOTS AND NOT ONE.
//
// One shot apiece is the tightest possible match and it was too tight. Holding the shot
// counts equal makes the firing cue cancel only if firing is DETERMINISTIC per shot, and
// nothing says it has to be: `specs/ui.md` asks for a cue when an emitter fires, and a
// build is free to thin a gun that fires several times a second so it does not
// machine-gun. One of the builds this was re-checked against plays its firing cue on a
// per-shot coin flip. With a single shot in each window the firing term is then a
// coin flip in each, independently — so the control window could land a firing cue that
// the kill window did not, and the death cue (worth exactly 1) failed to exceed it. That
// is roughly a one-in-fourteen chance of failing a build whose death cue works, decided
// by nothing but chance.
//
// Four shots per window keeps the property the design rests on — the counts are equal, so
// a per-shot firing cue still cancels and still cannot fake a death cue — while making
// the signal four kills against a difference of two small binomials. For the check to go
// wrong now, every one of the control window's four shots would have to play a firing cue
// and none of the kill window's four, which is vanishingly unlikely at any rate, and
// impossible for the two cases that actually occur: a firing cue on every shot (both
// windows carry four, and they cancel exactly) or none at all (both carry zero).
//
// The margin of 2 rather than a bare `>` covers the other direction. A build with NO
// death cue and a thinned firing cue can still come out one ahead by luck; requiring the
// kill window to lead by two makes that a fraction of a percent, at a cost of nothing to
// a build that plays a death cue, which leads by four.
//
// A Lance posed hot one-shots a Mote, so every shot in the kill window is exactly one
// kill and the two windows' shot counts stay equal by construction. A Core (1600 HP)
// shrugs off all four of the control window's shots, which is what makes it the control.
//
// WHY THE LANCE IS NOT POSED AT ITS REDLINE.
//
// It used to be posed at 92, its redline, for the full 3.5x multiplier — and at that
// heat it trips on the shot this item is built around. A Lance adds `heatPerShot /
// mass` per shot (48.9 / 2.8 = 17.5, specs/towers.md), so its first shot from 92 takes
// it to 100, which IS the trip (specs/heat.md). Both windows then hinge on whether a
// build reports `firing` on the same step it goes offline — a question specs/heat.md
// and specs/instrumentation.md leave open — and on a build that reports it the other
// way the Lance spends the next five seconds offline while the Core walks out of the
// scenario.
//
// None of that is this item's subject, and the full multiplier was never needed for
// it. A Lance at heat 60 multiplies by 0.35 + 3.15 * (60/92)^2 = 1.69 (specs/heat.md),
// so its shot does about 73 against a 40 HP Mote — a one-shot kill with room to spare.
// Heat is re-posed between shots so four of them cannot stack 17.5 apiece into the trip;
// that is a control op and consumes no time, so it changes nothing about the windows.
//
// Shots are counted as increases in the tower's own lifetime `damageDealt`
// (specs/instrumentation.md), not from the per-step `firing` flag, which is a flag a
// sweep can land either side of. A counter the build maintains for its own inspector is
// unambiguous, and it is the same one `targeting.fire-rate` and `info.counts` rely on.
//
// The baseline window's own cue is measured but NOT asserted on. Whether a shot is itself
// audible belongs to `audio.fire-cue`; requiring it here too would fail this item for a
// defect another item already owns, and the comparison is sound either way — a build that
// plays nothing at all fails it, because then neither window grows.
//
// EVERY READ OF THE AUDIO LOG IS A SETTLED ONE (`audioSettled`, not `audioCount`).
// The validate pass advances the simulation instantly, so a count taken on the tick an
// event happens gives the build no wall clock in which to schedule anything — and a
// build that raises its cues from its render frame, or rate-limits them against
// `AudioContext.currentTime`, has scheduled nothing yet. Both are conformant, and
// reading unsettled reported a full set of working cues as silence. See the note above
// `armAudio` in `_helpers`.

import {
  newGame,
  restartGame,
  build,
  spawn,
  tower,
  unit,
  armAudio,
  audioSettled,
  giveClockToBuild,
  untilOnOwnClock,
} from "../_helpers.mjs";

const LANCE_COL = 6;
const LANCE_ROW = 20;

// See the note above on why this is short of the Lance's 92 redline.
const LANCE_HEAT = 60;

// Shots per window. See the note above: enough that a thinned firing cue cannot swamp
// the death cues, few enough that both windows still fit a clip.
const SHOTS = 4;

// How far the kill window must lead the control window by. See the note above.
const MARGIN = 2;

// How long the build is left to run between reads while its shots are counted. A Lance
// fires at 0.8/s — 1.25 s between shots — so 120 ms is nowhere near coarse enough to merge
// two of them into one count, while still being most of what each round trip costs. If a
// build's Lance ever did fire fast enough for two shots to land inside one poll, the window
// would come up short of its shots and fail the premise assertion below loudly rather than
// miscounting quietly, and a Lance firing at 8/s is `targeting.fire-rate`'s business.
const SHOT_POLL_MS = 120;

/**
 * A Lance on the lane, posed hot — and NOTHING ELSE ON THE FLOOR YET.
 *
 * The targets are spawned by the caller, after the clock has been handed to the build. That
 * ordering is not incidental: the handover's first frame catches up everything the manual
 * clock accumulated (see `giveClockToBuild`), and on a floor that already had its Motes on
 * it the Lance spent that burst killing two of them before the window had counted a single
 * shot. The window then came up short of its four and the two windows stopped being
 * comparable. With the floor empty there is nothing for the burst to consume.
 */
async function poseLance(api, start) {
  await start(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const id = await build(api, "lance", LANCE_COL, LANCE_ROW);
  await api.call("setHeat", id, LANCE_HEAT);
  return id;
}

/** Put `count` units of `type` on the floor and return their ids. */
async function release(api, type, count) {
  const targets = [];
  for (let i = 0; i < count; i += 1) {
    targets.push(await spawn(api, type, "left"));
  }
  return targets;
}

/**
 * Let the build's own frame loop run until the emitter has landed `shots` more shots,
 * re-posing its heat afterwards so successive windows' self-heating cannot carry it into
 * the trip. Returns how many it actually landed, which the caller asserts on — a window
 * short of its shots is not comparable to one that got them all.
 *
 * The build drives itself here rather than being stepped, because a cue is played by the
 * presentation layer and a build is free to raise it from its frame loop; see the note above
 * `giveClockToBuild` in `_helpers`. That makes the window cost real time, which is why the
 * shots per window are few and the emitter is the one that kills in a single shot.
 *
 * 20 s is the ceiling: four shots at the Lance's 0.8/s is five seconds, so a conformant
 * build finishes with plenty to spare and a stuck one is cut off rather than hanging.
 */
async function fireShots(api, id, shots, { maxMs = 20000 } = {}) {
  let landed = 0;
  let dealt = (await tower(api, id)).damageDealt;
  await untilOnOwnClock(
    api,
    (s) => {
      const t = s.towers.find((x) => x.id === id);
      if (t && t.damageDealt > dealt) {
        landed += 1;
        dealt = t.damageDealt;
      }
      return landed >= shots;
    },
    { maxMs, stepMs: SHOT_POLL_MS },
  );
  await api.call("setHeat", id, LANCE_HEAT);
  return landed;
}

export default function item() {
  let coreId;
  let onShot;
  let onKill;
  let controlShots;
  let killShots = 0;
  let survived;
  let killed;

  return {
    id: "audio.death-cue",

    // Only the kill window is filmed (see `fireShots`): four shots at the Lance's
    // 0.8/s, polled every tick, which runs to roughly twice its five seconds of
    // simulation. See the clip-budget note in `_helpers`.
    clipMs: 11000,

    // Configuration A: the control — four shots at a Core, which survives all of them.
    // A match and armed audio; each window below poses its own Lance from a fresh start,
    // so nothing carries between them.
    async arrange(api) {
      await poseLance(api, newGame);
      await armAudio(api);
    },

    // Window 1: four shots, no death. Window 2 re-poses the same Lance against four
    // Motes and takes four more shots — the same firing, plus the kills it lands.
    async act(api) {
      // THE KILL WINDOW RUNS FIRST, AND THE CONTROL WINDOW MATCHES WHATEVER IT MANAGED.
      //
      // Both windows have to hold the same number of shots for the firing cue to cancel, and
      // fixing that number in advance made the premise fragile: on one build a Mote
      // occasionally died a beat before its shot was counted, the kill window came up one
      // short of four, and the item failed on the premise while its actual verdict — four
      // more cues than the control — passed cleanly. Running the kills first and then asking
      // the control for exactly as many shots makes the two equal by construction, whatever
      // the run happened to manage.
      const killLance = await poseLance(api, restartGame);
      await giveClockToBuild(api);
      await api.call("setHeat", killLance, LANCE_HEAT);
      const killBefore = await audioSettled(api);

      // ONE MOTE AT A TIME, each released only once the last is gone. Releasing all four
      // together looked equivalent and is not: the Lance takes 1.25 s between shots, so the
      // last of them waits five seconds, and a Mote covers 60 px/s — far enough in that time
      // to walk out of range or off the floor. Feeding them in keeps every shot a kill.
      const targets = [];
      for (let i = 0; i < SHOTS; i += 1) {
        const mote = (await release(api, "mote", 1))[0];
        targets.push(mote);
        killShots += await fireShots(api, killLance, 1, { maxMs: 8000 });
      }
      onKill = (await audioSettled(api)) - killBefore;
      killed =
        (await api.snapshot()).surge.filter((u) => targets.includes(u.id))
          .length === 0;

      // The control: the same Lance, the same number of shots, at something that survives
      // them. Clock first, then the baseline, then the target — so the handover's catch-up
      // burst falls outside the counted delta and nothing is shot before the count opens.
      const ctlLance = await poseLance(api, restartGame);
      await giveClockToBuild(api);
      await api.call("setHeat", ctlLance, LANCE_HEAT);
      const shotBefore = await audioSettled(api);
      coreId = (await release(api, "core", 1))[0];
      controlShots = await fireShots(api, ctlLance, killShots, {
        maxMs: 8000 * Math.max(1, killShots),
      });
      onShot = (await audioSettled(api)) - shotBefore;
      survived = (await unit(api, coreId)) !== null;

      await api.advance(30); // a short tail so the clip shows the last kill
    },

    async assert(api, check) {
      // The premise both readings rest on: each window really did contain the same
      // number of shots. A short window is not comparable to a full one, and the
      // difference below would be measuring the shortfall rather than the deaths.
      // Enough kills for the difference to carry, and the control matched to them exactly —
      // the firing cue only cancels between windows of equal size.
      check.expectGe(
        `the kill window landed enough shots to measure (${killShots})`,
        killShots,
        MARGIN + 1,
      );
      check.expectEq(
        "the control window fired the same number of shots",
        controlShots,
        killShots,
      );

      check.expectOk("the Core survives all of them", survived);
      check.expectOk("the same Lance kills every Mote outright", killed);
      check.expectGe(
        `killing shots play more than shots that kill nothing (the death cue; ${onShot} -> ${onKill})`,
        onKill - onShot,
        MARGIN,
      );
    },
  };
}
