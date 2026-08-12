// Automated validation for the Saucer item `cadence`: a saucer crosses, leaves, and the
// next one arrives on the spec's cadence rather than immediately. `specs/hazards.md` sets
// both halves: a saucer "despawns after it has crossed roughly 1.5 field widths or after
// about 12 seconds, whichever comes first", and "a new one appears every 25 to 35 seconds
// while the ship is alive and in play". Together they make the saucer a periodic visitor,
// and the field is clear of one for most of a game. A build that keeps a saucer up
// continuously, or replaces each one the instant it leaves, has changed what the enemy is:
// the pressure that is meant to arrive, be dealt with, and pass becomes permanent.
//
// The game's own clock drives all of it. Nothing here spawns or removes a saucer: the item
// watches the build's own cadence, which is the only thing that can be watched, since
// `removeSaucer` is exactly the event a build may schedule the next arrival from — asking
// for one is asking the build to re-roll the interval being measured. For the same reason
// this does NOT use `newGame`: that helper calls `clearRocks` and `removeSaucer`, and
// removing a saucer that was never there can restart the cadence on a build that keys off
// the call. The game is started and left alone.
//
// The measurement is a single continuous watch that records the LONGEST unbroken stretch
// with a saucer on the field and the longest without one, rather than timing the transitions
// between them. That is deliberate. A build that replaces its saucer within a single sample
// has no observable departure at all, and an item written around "when did it leave" reports
// a sweep that timed out instead of the defect that caused it. Longest-run figures degrade
// honestly: the run with no saucer simply comes back as zero.
//
// WHAT THE THRESHOLDS COME FROM. The spec gives the interval as 25 to 35 seconds without
// saying between which two events, and both readings are live: a build may count from the
// previous arrival or from its departure. Read as arrival-to-arrival, a saucer present for
// its full ~12 s leaves at least 13 s of clear field before the next one; read as
// departure-to-arrival it leaves 25 s. The assertion takes the smaller and keeps a margin
// under it — a clear stretch of more than 10 seconds — so it holds under either reading and
// says nothing about a build landing anywhere in the legitimate range. What it rejects is
// the case with no reading at all: one graded run put the next saucer up 0.05 s after the
// last one left, and nothing caught it.
//
// The 16 s allowed for a visit is "about 12 seconds" with room for a build that hits the
// 1.5-field-width limit first (1920 px at the spec's 140 px/s cruise is 13.7 s). The same
// graded run held one saucer on the field for 36 s.
//
// The clip is the watch itself, capped by `clipMs`: the record pass films the visit ending
// and the clear field that follows, then stops when the budget runs out, which is a normal
// end to a record pass. The verdict comes from the uncapped validate pass regardless.

import { ticks } from "../_helpers.mjs";

// How long to watch after the first saucer arrives. A legitimate build can take a
// ~12 s visit plus a 35 s gap before the next arrival, so this covers the slowest
// conformant cadence with room to spare.
const WATCH = ticks(60);
// The sampling interval, in ticks. 0.05 s is fine enough that a visit and a gap are
// timed to a twentieth of a second, and coarse enough that the watch stays cheap.
const POLL = 6;
const POLL_SECONDS = POLL / 120;

// The bound on the first arrival: "about 18 seconds into a game", with headroom.
const FIRST_ARRIVAL_MAX = ticks(30);

// A visit may last "about 12 seconds"; allow the 1.5-field-width crossing too.
const VISIT_MAX_SECONDS = 16;
// The field must be clear of saucers for longer than this between visits.
const CLEAR_MIN_SECONDS = 10;

export default function item() {
  // Whether a saucer ever arrived at all, and what the watch after it saw.
  let arrived;
  let longestVisit;
  let longestClear;
  let departed;
  let returned;

  return {
    id: "saucer.cadence",
    clipMs: 20000, // film the visit ending and the clear field that follows

    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("startGame");
      await api.call("setInvuln", 99); // seconds — the ship survives the whole watch

      // Skip to the first arrival. Instant in BOTH passes, so the clip opens on the
      // visit this item is about rather than eighteen seconds before it.
      const first = await api.skipUntil((s) => s.saucer !== null, {
        max: FIRST_ARRIVAL_MAX,
        poll: 12,
      });
      arrived = first.hit;
    },

    async act(api) {
      let visit = 0;
      let clear = 0;
      longestVisit = 0;
      longestClear = 0;
      departed = false;
      returned = false;

      for (let t = 0; t < WATCH; t += POLL) {
        await api.advance(POLL);
        const present = (await api.snapshot()).saucer !== null;
        if (present) {
          if (departed) returned = true;
          visit += POLL_SECONDS;
          clear = 0;
          longestVisit = Math.max(longestVisit, visit);
        } else {
          if (visit > 0) departed = true;
          clear += POLL_SECONDS;
          visit = 0;
          longestClear = Math.max(longestClear, clear);
        }
      }
    },

    async assert(api, check) {
      check.expectOk("a saucer arrives on the game's own cadence", arrived);
      check.expectOk("it leaves again on its own", departed);
      check.expectLt(
        "a saucer crosses and goes rather than holding the field",
        longestVisit,
        VISIT_MAX_SECONDS,
      );
      check.expectOk("another saucer follows it", returned);
      check.expectGt(
        "the field is clear of saucers between one visit and the next",
        longestClear,
        CLEAR_MIN_SECONDS,
      );
    },
  };
}
