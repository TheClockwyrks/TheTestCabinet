// Automated validation for the Audio item `cues-survive-stepping`: the build plays its cues on
// whichever clock is driving the simulation, so a cue that sounds during normal play still
// sounds when the tick is supplied by `step` (`specs/instrumentation.md`).
//
// WHY THIS ITEM EXISTS. Every other audio item measures under the MANUAL clock, because that is
// the clock the validate pass holds — so all of them are blind in the same direction. A build
// that flushes its cue queue only while `autoStep` is on fails all ten at once, each reporting
// nothing more than a cue that did not sound. That is a true statement and a useless one: it
// reads as ten broken sounds to anyone who has played the build and heard every one of them
// working, and it points at the audio engine, which is the one part that is fine. One run
// implementation did exactly this — a single `if (!autoStep) return` ahead of its event drain —
// and the ten failures said nothing about where it was.
//
// So this item measures the SAME build on both clocks and reports the difference, which is the
// defect stated once. Its three cues are the three the rest of the category already relies on
// (a stamp on a placement, a settle on the harvest's hardening, a zap on a shot), so it is
// exactly as portable as they are; nothing here asks a build for a cue no other item asks for.
//
// WHAT EACH ASSERTION RULES OUT. The failure is only attributable because the ones around it
// close off every other reading:
//
//   * the FIRST cue says the build plays audio at all, so a silent third cue is not a silent
//     build (that is `music`'s job, and a build failing there fails it there);
//   * the SECOND cue says cues are not capped at one per session — see the throttle note in
//     `_helpers.mjs`, and note the two prototypes of this item that failed against the REFERENCE
//     for exactly that reason;
//   * `the tower fired` says the event under test actually happened, so a silent cue is not a
//     shot that never came;
//   * and only then does the THIRD cue mean what it says.
//
// A build that flushes unconditionally passes all four. A build that gates its flush on the
// clock passes the first three and fails the last, which is the whole diagnosis.
//
// EVERYTHING IS `arrange`, AND NOTHING HERE MAY OPEN WITH `startBuild`. The first two cues have
// to land on the clock the build BOOTS with (`autoStep` is on by default for normal play), and
// that window closes the moment anything resets or steps: `startBuild` resets, `runPass` sets
// the flag between `arrange` and `act`, and `api.advance` is a real-time wait in the record pass
// rather than a step. So the board is posed with CONTROL OPS ONLY, and the clock is handed over
// exactly once, deliberately, with `api.skip` — which is an exact `step` in BOTH passes, so the
// stills depict the same clock the verdict was read on. `act` is a short tail for the paint.
//
// This is the audio half of a wider claim. The same drain carries a build's particle effects
// (`specs/assets.md`), so a build that fails here is dropping its VFX under the manual clock
// too; the produced-art items are reviewer-graded and would show it only as media that quietly
// disagrees with the yard.

import {
  armAudio,
  audioCount,
  audioCueLabel,
  towerById,
  waitForAudio,
  SECOND,
  SPOTS,
  unmetPrecondition,
} from "../_helpers.mjs";

// How long to let the wave walk into the kept tower's reach, and how long to give it to fire
// once something is there. Both are spent with `skip`/`skipUntil`, so they are instant in both
// passes and cost the recording nothing.
const APPROACH_MAX = 120 * SECOND;
const FIRE_MAX = 8 * SECOND;
// A beat so the record pass has an `act` to replay; the verdict is fixed by the end of `arrange`.
const TAIL_TICKS = 1 * SECOND;

export default function item() {
  // The audio log either side of each of the three cues, and whether the shot ever came.
  let stampBefore;
  let stampAfter;
  let settleBefore;
  let settleAfter;
  let fireBefore;
  let fireAfter;
  let fired;

  // Roll an exact rock and drop it, returning the candidate's id (or null if it was refused).
  async function place(api, col, row) {
    await api.call("setNextRoll", "capacitor", 1);
    await api.call("placeRock", col, row);
    const s = await api.snapshot();
    return s.towers.find((t) => t.col === col && t.row === row)?.id ?? null;
  }

  return {
    id: "audio.cues-survive-stepping",

    async arrange(api) {
      // `startRun` opens the yard without touching the clock — no `reset`, no `step`, so the
      // build is still on the clock it boots with. Integrity is put out of reach because the
      // wave this item's harvest sends goes deliberately under-defended.
      await api.call("startRun", { map: "substation", difficulty: "medium" });
      await api.call("setIntegrity", 999);
      await armAudio(api);

      // (1) A STAMP, on the build's own clock: a rock drops from the press.
      stampBefore = await audioCount(api);
      const keeper = await place(api, SPOTS[0].col, SPOTS[0].row);
      stampAfter = await waitForAudio(api, stampBefore);
      // A second candidate, so the harvest below has something to harden into a blocker.
      const spare = await place(api, SPOTS[1].col, SPOTS[1].row);
      if (!keeper || !spare) {
        throw unmetPrecondition(
          "the two opening rocks were refused on the Substation's entry corridor, so there is " +
            "no placement and no harvest to listen to",
        );
      }

      // (2) A SETTLE, still on the build's own clock: keeping one candidate hardens the other.
      settleBefore = await audioCount(api);
      await api.call("keep", keeper);
      settleAfter = await waitForAudio(api, settleBefore);

      // (3) Hand the clock over — `skip`/`skipUntil` are an exact `step` in both passes, and
      // `step` is what turns `autoStep` off (`specs/instrumentation.md`) — then walk the wave
      // the harvest sent into the kept tower's reach and let it shoot.
      const t = towerById(await api.snapshot(), keeper);
      const reach = Math.max(t?.range ?? 0, 0);
      await api.skipUntil(
        (s) => s.units.some((u) => Math.hypot(u.x - (t?.cx ?? 0), u.y - (t?.cy ?? 0)) <= reach + 30),
        { max: APPROACH_MAX, poll: 3 },
      );

      fireBefore = await audioCount(api);
      const r = await api.skipUntil((s) => Boolean(towerById(s, keeper)?.firing), {
        max: FIRE_MAX,
        poll: 1,
      });
      fired = r.hit;
      await api.screenshot("stepped-shot");
      fireAfter = await waitForAudio(api, fireBefore);
    },

    async act(api) {
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectGt(
        audioCueLabel("a cue plays on the clock the build boots with", stampAfter),
        stampAfter,
        stampBefore,
      );
      check.expectGt(
        "...and a second, different cue plays too, so cues are not capped at one per session",
        settleAfter,
        settleBefore,
      );
      check.expectOk("the kept tower fired once the simulation was being stepped", fired);
      check.expectGt(
        "...and ITS cue plays too — a cue does not depend on which clock drives the tick",
        fireAfter,
        fireBefore,
      );
    },
  };
}
