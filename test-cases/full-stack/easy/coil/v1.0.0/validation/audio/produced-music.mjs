// Automated validation for the Audio item `produced-music`: a looping music bed plays
// under the round (specs/ui.md, specs/assets.md). Unlike the one-shot cues, the bed is
// not tied to a game EVENT, so what the audio log is read across is the only path a
// player has into a live round: press Enter on the title, confirming the play entry.
//
// That single keypress is the whole point, and it is driven as a REAL browser gesture
// (`api.userKey`, not the debug `press`) because it has to do two things at once — it
// is both the first interaction, which is the only thing allowed to start audio
// (specs/ui.md: browsers block autoplay), and the input that begins the round. A build
// gets one handler to do both in, and how it sequences them is exactly what this item
// is about. Driving the two halves separately — arming audio, then calling the debug
// API's `startRound` — inserts a gap between them that no player ever produces, and a
// build that only has its bed ready once that artificial gap has elapsed then passes a
// check while being silent for a real player's whole first round. So: one gesture, then
// wait, and require the bed to start.
//
// WAIT, rather than sample at a fixed instant. Arming triggers an async fetch +
// decodeAudioData of the produced .wav (real wall-clock work no amount of instant
// ticking can wait out), and a build is free to start the bed whenever that lands —
// straight from the gesture handler, or on a retry once the decode resolves. Both are
// conformant, and BED_WAIT_MS is generous enough for either. What is not conformant is
// never starting it at all, which is what a build that fires its start-the-bed path
// once, before its own buffers exist, and never revisits it amounts to: silence under
// the round the player is actually playing.
//
// `api.settle` (unlike `api.advance`) is a genuine real-time pause in BOTH passes (see
// `packages/browser-driver/validation.mjs`), so it is what the wait is built from
// rather than the tick-based `api.advance` this case's other items use.
//
// THE GATE IS "DID THE KEYPRESS REACH A ROUND", AND IT IS SAMPLED THROUGHOUT THE WAIT
// rather than read off the state at the end of it. Both ends of that matter, and an
// earlier revision got the second one wrong by reading the screen once, after the full
// wait, and requiring it to still be `playing`:
//
//   * A build may not reach the round in the same turn as the keypress — a title
//     transition, or a round that starts once the audio decode lands — so a single
//     read taken immediately would fail a conformant build for being a frame late.
//   * A build may not still BE in the round by the end. Nothing here steers, and the
//     snake starts at col 15 heading right, so it has about 1.75 s before it runs out
//     of board — inside a wait deliberately set to 3 s. Whether it gets that far
//     depends on whether the build's own clock is running during the wait, which
//     `api.reset` leaves off (the debug API's manual clock) but which a build that
//     re-arms it on the round-start path turns back on. That is a genuine defect — the
//     spec has only `reset`, `step` and `setAutoStep` touch that flag — but it is
//     `controls.advances-in-real-time`'s defect to report, and it is not evidence
//     about music. Reading the screen at the end let it land here instead, failing a
//     build whose bed played perfectly and telling the reviewer, wrongly, that Enter
//     had not started a round.
//
// Sampling across the wait answers the question the gate is actually asking — was
// there a round for the bed to play under — and answers it the same way whichever
// clock the build is running.

import { actPlayOn, audioCount } from "../_helpers.mjs";

// Real wall-clock slices to wait, and for how long in total, for a source to appear
// after the round begins. 3 s is far past the fetch + decode of a handful of small
// local .wav files, so a build that has not started its bed by then is not going to.
const BED_POLL_MS = 250;
const BED_WAIT_MS = 3000;

// A beat of live play after the reading, purely so the clip is a round running. It also
// evens out the two outcomes: a build that starts its bed at once breaks the wait on
// the first poll and would otherwise film about a second, against the full 3 s a build
// that never starts one films — an odd side-by-side for a reviewer. The snake begins at
// col 15 facing right and is never steered, so 8 ticks stop well short of the right
// wall and the round cannot end on camera.
const HOLD_TICKS = 8;

export default function item() {
  let before;
  let after;
  let reachedRound;

  return {
    id: "audio.produced-music",

    async arrange(api) {
      // The title, with audio not yet armed — where a player starts.
      await api.reset();
    },

    async act(api) {
      before = await audioCount(api);

      // The one real gesture: confirm the title's play entry. This is the first
      // interaction AND the round start, in that order, in the build's own handler.
      await api.userKey("Enter");
      reachedRound = (await api.snapshot()).screen === "playing";

      // Give the bed every chance to start — including on a retry once the decode
      // lands — but stop as soon as it does, so the clip is not padded with silence
      // after the evidence. The screen is sampled on the way past: a round seen live at
      // ANY point in the wait is a round the bed had to play under, whether the build
      // entered it a beat after the keypress or had already run out of board by the
      // end of the wait.
      after = before;
      for (let waited = 0; waited < BED_WAIT_MS; waited += BED_POLL_MS) {
        await api.settle(BED_POLL_MS);
        if ((await api.snapshot()).screen === "playing") reachedRound = true;
        after = await audioCount(api);
        if (after > before) break;
      }

      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      // If Enter did not reach a live round the audio reading means nothing, so say so
      // rather than reporting a missing bed the item never gave the build a chance to
      // start.
      check.expectEq(
        "pressing Enter on the title starts a round",
        reachedRound,
        true,
      );
      check.expectGt(
        "a Web Audio source starts under the round the keypress began (the music bed)",
        after,
        before,
      );
    },
  };
}
