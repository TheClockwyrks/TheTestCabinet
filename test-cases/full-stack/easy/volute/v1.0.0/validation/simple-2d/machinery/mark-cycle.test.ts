// machinery/mark-cycle — the marks of a level come up choke, backflow, bore, sightline.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("Marks"): "A mark names one
// machinery kind, and the kinds follow a fixed cycle: `choke`, `backflow`,
// `bore`, `sightline`, then `choke` again. The first mark of a level names
// `choke`, and the cycle position restarts with the count." The marks fall on
// "the 12th, 24th, 36th and so on" core of the level, so the four the drive
// reads are cores 12, 24, 36 and 48 — which is why it runs on level 5, the only
// level whose quota (90, `specs/progression.md`) delivers a 48th core at all.
//
// HOW THE COUNTER IS WALKED. `specs/instrumentation.md` (`setQuotaRemaining`):
// "The count of cores emitted this level is the level's quota less what remains,
// so which of the following emissions carry a mark, and which kind each mark is,
// follow the new value." So setting the quota remaining to `quota - (n - 1)`
// makes the next core the inlet emits the `n`th core of the level. `clearTrain`
// then empties the channel, and `specs/channel.md` ("Emission") says "A channel
// carrying no core satisfies that condition, so an emission follows at once" —
// one tick later exactly one core stands on the channel, and it is the `n`th.
//
// WHAT IS READ, AND WHY. The mark itself, off `snapshot().train[].mark`, which
// `specs/instrumentation.md` reports as "one of the four machinery kinds or
// `null`". The review item's own note suggests reaching the same answer by
// extracting each marked run and watching what is granted; that reads the mark
// through the granting rule, which is `grant-on-extraction`'s requirement, and
// through the bore's removal, which is `bore-radius`'s — so a build with a
// correct cycle and a broken grant would fail three points for one defect. This
// check decides the cycle and only the cycle. Nothing here poses a mark: every
// mark read is one the build's own counter decided.
//
// THE TOLERANCE. None to pick — four equalities against the named kinds, and one
// count of cores on the channel, both whole values the snapshot reports.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MARK_CYCLE, MARK_INTERVAL, levelSpec } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  head,
  type Harness,
} from "../harness";

/**
 * The level the cycle is walked on.
 *
 * The fourth mark falls on the 48th core, so the level has to deliver 48: level
 * 5's quota of 90 is the only one that does (`specs/progression.md`).
 */
const LEVEL = 5;

/** That level's quota, from the specs' own table. */
const QUOTA = levelSpec(LEVEL).quota;

/**
 * Ticks each marked core is ridden out for, after its mark has been read.
 *
 * Evidence only. `specs/channel.md` emits again once the tail has ridden a
 * channel spacing out, which at level 5's feed speed of 38 units/s takes 44
 * ticks, so 20 leaves the channel holding the one core the check read.
 */
const SHOWN_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`names the marks of a level ${MARK_CYCLE.join(", ")} in turn`, async () => {
  await h.debug.startLevel(LEVEL);

  await captureReplay(h, "cycle", async () => {
    for (let index = 0; index < MARK_CYCLE.length; index += 1) {
      const nth = MARK_INTERVAL * (index + 1);

      // Put the inlet one core short of the nth of the level, and empty the
      // channel so the next tick emits it and nothing else.
      await h.debug.setQuotaRemaining(QUOTA - (nth - 1));
      await h.debug.clearTrain();
      const emitted = await h.step();

      assertEqual(
        coreCount(emitted),
        1,
        `the cores on the channel after the inlet emitted core ${nth}`,
      );
      assertEqual(
        emitted.emitted,
        nth,
        `the count of cores that have entered level ${LEVEL}`,
      );
      assertEqual(
        head(emitted).mark,
        MARK_CYCLE[index],
        `the kind named by mark ${index + 1} of the level, on its ${nth}th core`,
      );
      await h.step(SHOWN_TICKS);
    }
  });
});
