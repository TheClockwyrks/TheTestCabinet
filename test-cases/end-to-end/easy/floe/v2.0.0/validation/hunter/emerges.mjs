// Automated validation for the Hunter item `emerges`.
//
// No bear is present at the start of a crossing; one emerges from the near shore only
// once the critter has advanced a few rows. A fresh crossing is held on the near shore
// and must stay unhunted; the critter is then advanced (onto a cleared, safe row) and
// the real emerge logic brings a bear out, which the snapshot reads back. See
// validation/_helpers.mjs.
//
// THE WORD THE ITEM TURNS ON IS "ONLY". specs/hunter.md: the bear emerges "once the
// critter has advanced a few tiles forward off the near shore, so a fresh crossing
// always begins with a short head start, not an instant threat". Read as a single
// fact — that a bear eventually comes out — the rule is satisfied by a build that puts
// one on the board the tick the run begins, which is the exact opposite of what the
// sentence is for. So the item now drives both halves: the critter is left standing on
// the near shore for well over a second and NOTHING may hunt it, and only then is it
// advanced and a bear required. One build audited against this case emerges its bear
// on the critter's own spawn tile a tick into every crossing and catches it there,
// three lives inside two seconds, and the first half is what sees it.
//
// The idle half watches the LIFE as well as the bear. A bear that appears on the spawn
// tile and catches the critter in the same breath is present for a tick or two, which
// a sweep can step straight past; the life it costs does not go away. Either is the
// same failure of the same sentence.
//
// THE ADVANCE IS BOTH POSED AND HOPPED. specs/hunter.md gates the emergence on the
// critter "having advanced a few tiles forward off the near shore", which is a fact
// about where the critter is — but a build is free to keep its own tally of forward
// hops instead of reading the board, and one audited against this case does exactly
// that, so a critter PLACED eight rows up leaves its hunter asleep indefinitely. Both
// readings are honest readings of the same sentence, and this item is about the bear
// rather than about which one a build took, so the advance satisfies both: the critter
// is placed most of the way up and then hops the last two rows through the real play
// code. A build reading the board and a build counting hops have each seen an advance.
//
// AND THE CLIP HAS A FLOOR. `act` is the recording, and its second half ends the tick
// a bear appears — so against a build that emerges one promptly the whole clip was a
// few frames long, with the emergence itself on the last of them. The idle window
// gives the clip a fixed opening whatever the build does, and the tail holds on the
// bear that came out, moving.

import { startCrossing } from "../_helpers.mjs";

// The row the critter finishes the advance on, and the column both halves happen in.
// Row 15 is mid-band, several rows up from the near shore — plainly "advanced a few
// tiles". It is placed two rows below that and hops the rest.
const COL = 20;
const ADVANCED_ROW = 15;
const HOPS = 2;
const HOP_TICKS = 18; // 0.15 s, just past the hop cooldown, so each press lands

// How long the fresh critter is left standing on the near shore, unadvanced. The spec
// fixes no number for the head start, so this is not a measurement of one: it is long
// enough that a build which hunts an unadvanced critter has plainly done so, and short
// enough to leave a build that waits for the advance entirely untouched.
const IDLE_TICKS = 180; // 1.5 s

// How long the clip keeps filming once the bear is out, so the emergence is watched
// rather than glimpsed on the closing frame.
const TAIL_TICKS = 144; // 1.2 s

export default function item() {
  // Whether a bear was present at the very start (read instantly in `arrange`), the
  // lives the crossing opened with, the idle window's sweep, and the sweep that waited
  // for the emergence.
  let bearAtStart;
  let livesAtStart;
  let idle;
  let r;

  return {
    id: "hunter.emerges",

    // A fresh crossing: the critter on the near shore where the run puts it, and no
    // bear yet.
    async arrange(api) {
      await startCrossing(api);
      const s = await api.snapshot();
      bearAtStart = s.bears[0].present;
      livesAtStart = s.lives;
      // Clear the rows the advance passes through, so nothing on the road can end the
      // crossing while the bear is being waited for.
      for (let r = ADVANCED_ROW; r <= ADVANCED_ROW + HOPS; r += 1) {
        await api.call("setLane", r, { cols: [] });
      }
    },

    // The head start first — the critter waiting on the near shore with nothing hunting
    // it — then the advance, and the emergence it earns.
    //
    // The emergence window is deliberately generous. specs/hunter.md fixes only that the
    // bear emerges once the critter "has advanced a few tiles"; it pins no delay, so a
    // window sized to one build's constant would fail another that is equally correct,
    // just slower off the mark. What is under test is that the bear DOES emerge.
    async act(api) {
      idle = await api.until(
        (s) => s.bears.some((b) => b.present) || s.lives < livesAtStart,
        { max: IDLE_TICKS, poll: 2 },
      );

      // Advance a few rows: most of the way by placement, the last two by real hops.
      await api.call("placeCritter", COL, ADVANCED_ROW + HOPS);
      for (let i = 0; i < HOPS; i += 1) {
        await api.call("press", "ArrowUp");
        await api.advance(HOP_TICKS);
      }
      r = await api.until((s) => s.bears[0].present, { max: 600, poll: 6 }); // 5 s at 0.05 s
      await api.advance(TAIL_TICKS); // camera only: the bear that came out, moving
    },

    async assert(api, check) {
      check.expectEq("no bear at the start of a crossing", bearAtStart, false);
      check.expectOk(
        "and none hunts the critter until it has advanced off the near shore",
        !idle.hit,
      );
      check.expectOk("the bear emerges once the critter has advanced", r.hit);
      check.expectEq("the bear is now present", r.snap.bears[0].present, true);
    },
  };
}
