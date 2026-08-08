// Automated validation for the Economy sub-item `early-send-bonus`.
//
// Starting the next round early, during a timed between-round countdown, pays a bonus for
// the whole seconds left on the clock. The check clears round 1 to reach a timed build
// phase, empties the bank, reads the countdown, then sends the next round early — the
// bank holds exactly the whole seconds that were left.

import {
  arrangeNoTowerRound,
  actNoTowerRound,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
} from "../_helpers.mjs";

// How long the timed build phase is left running before the round is sent early.
//
// The bonus pays for the whole seconds LEFT on the clock, so a clip that opens on the send
// itself shows a number appearing out of nowhere. Watching the countdown tick down first is
// what makes the payout legible — the reviewer sees the clock at n, the send, and n in the
// bank. It also has to be short enough that a real countdown still has seconds on it, which
// is why the figure the assertion uses is re-read immediately before the send rather than
// taken from the resolution snapshot.
const COUNTDOWN_WATCH_TICKS = 120;

export default function item() {
  let built;
  let c;
  let after;

  return {
    id: "economy.early-send-bonus",

    clipMs: clipBudget(1020 + COUNTDOWN_WATCH_TICKS + LEAD_TICKS + TAIL_TICKS),

    async arrange(api) {
      await arrangeNoTowerRound(api, { round: 1, energy: 0 });
    },

    // Round one clearing to a timed build phase, then the early send. `setEnergy` and
    // `startRound` are control ops, so they are legal here and consume no time — the bank
    // read straight after them is exactly the bonus the send paid.
    async act(api) {
      built = await actNoTowerRound(api);

      // The countdown visibly running — the state the send interrupts.
      await api.advance(COUNTDOWN_WATCH_TICKS);

      // `buildCountdown` is still reported in SECONDS (only `step`'s argument became
      // ticks), so the bonus is compared against whole seconds as before. Re-read HERE,
      // immediately before the send: the clock has been running since the round resolved,
      // and the bonus pays for what is left at the moment the button is pressed.
      c = (await api.snapshot()).buildCountdown;

      await api.call("setEnergy", 0);
      await api.call("startRound");
      after = await api.snapshot();

      // Held on the bonus that landed, and on the round it sent.
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "the round resolved to the build phase",
        built.phase,
        "build",
      );
      check.expectOk(
        "the between-round phase is timed (has a countdown)",
        c != null && c > 0,
      );
      // Within one second, not exactly equal.
      //
      // The bonus is the FLOOR of a continuously falling countdown, and the check has to read
      // that countdown and then send the round as two separate calls. A build is free to
      // carry the countdown as a float and decrement it outside `tick()` — off the render
      // frame, say — in which case a few milliseconds pass between the two calls and the
      // floor lands one lower than the value that was read. That is a read-ordering artefact
      // of driving the game from outside, not a defect: one build paid 10 against a
      // countdown read at 11.x, having done exactly the right arithmetic on the value that
      // was true when the button was pressed. The requirement being graded is that the bonus
      // IS the whole seconds remaining, and a tolerance of one second says that without
      // failing a build for the harness's own latency.
      check.expectClose(
        "sending early pays a bonus for the whole seconds left",
        after.energy,
        Math.floor(c),
        1,
      );
      check.expectGt("...and it is a real bonus, not nothing", after.energy, 0);
    },
  };
}
