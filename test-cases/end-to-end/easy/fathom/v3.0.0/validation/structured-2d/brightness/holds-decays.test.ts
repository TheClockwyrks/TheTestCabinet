// brightness/holds-decays — brightness holds, then decays.
//
// The claim: after eating, `G` is unchanged over the whole `BRIGHT_HOLD` (`1.0 s`)
// window, and from then on it halves every `BRIGHT_HALFLIFE` (`0.9 s`) — so it is
// never a constant drain and never decays during the hold — and a further plankton
// eaten mid-decay arms the hold in full again.
//
// THE EAT IS THE REAL ONE. specs/sensing.md arms the hold on eating, so the
// scenario travels the forager into the next pellet under a held action rather
// than posing `G` with `setBrightness`. That operation arms the hold too, which
// would make the reading a reading of the operation.
//
// THE WINDOW IS WATCHED, NOT SAMPLED ONCE. A single read cannot tell a hold from a
// slow drain, so `G` is read at four moments inside the hold and at both
// halflives past it. Each read is taken a whole number of ticks after the tick the
// pellet went, which is the unit specs/movement.md integrates every rate in.
//
// THE BOARD CANNOT CLEAR UNDER THE MEASUREMENT. The posed fixture carries a sealed
// larder, so `planktonRemaining` never reaches zero however much of the run the
// forager grazes, and the maze cannot clear and descend mid-window.

import { afterEach, beforeEach } from "vitest";
import { BRIGHT_HALFLIFE, BRIGHT_HOLD } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  DIR_KEY,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { check, clearUnderfoot, failPrecondition } from "../scene";

/** The hold and the halflife, in whole simulation ticks. */
const HOLD_TICKS = ticksFor(BRIGHT_HOLD);
const HALFLIFE_TICKS = ticksFor(BRIGHT_HALFLIFE);

/**
 * When inside the hold `G` is read, in ticks after the tick the pellet went.
 *
 * The last of them is one tick short of the hold's end. A read taken exactly on
 * the boundary asks which side of it a build applies the first decay tick on, and
 * specs/sensing.md fixes the hold's LENGTH rather than that tie; one tick of decay
 * is under a thousandth of `G`, so the tie costs nothing either way and the check
 * does not turn on it.
 */
const HOLD_READS = [
  Math.round(HOLD_TICKS / 4),
  Math.round(HOLD_TICKS / 2),
  Math.round((HOLD_TICKS * 3) / 4),
  HOLD_TICKS - 1,
];

/**
 * How far `G` may sit from the value the eat set it to, across the hold.
 *
 * The review item's own bound. It is far tighter than the drain a build that
 * decayed through the hold would show: half a halflife of decay off `BRIGHT_PER_EAT`
 * is more than a tenth of `G`, forty times this.
 */
const HOLD_TOLERANCE = 0.01;

/** How far `G` may sit from the halving the decay curve gives. */
const DECAY_TOLERANCE = 0.02;

/** How long a single eat may take under a held action, in ticks. */
const EAT_BUDGET = ticksFor(0.75);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Travel the forager into the next pellet, and report `G` on the tick it went.
 *
 * The sweep polls every tick, because the moment is what is read: a coarser sweep
 * could step over two pellets at once — they sit one tile, thirty ticks, apart at
 * `FORAGER_SPEED` — and report one eat as two.
 */
async function eatOne(harness: Harness): Promise<{ g: number; ticks: number }> {
  const before = harness.snapshot();
  harness.hold(DIR_KEY.right);
  const eaten = await harness.until(
    (s) => s.planktonRemaining < before.planktonRemaining,
    { maxFrames: EAT_BUDGET, poll: 1 },
  );
  harness.release(DIR_KEY.right);
  if (!eaten.hit) {
    const after = harness.snapshot().forager;
    const moved = Math.hypot(
      after.x - before.forager.x,
      after.y - before.forager.y,
    );
    failPrecondition(
      "the forager to travel into the plankton on the next tile under a held " +
        "movement action, so this point could read the brightness that eating " +
        "arms (specs/gameplay.md, specs/movement.md)",
      "the controls and maze-movement points",
      `${moved.toFixed(1)} units moved, no plankton eaten in ${EAT_BUDGET} ticks`,
    );
  }
  return { g: eaten.snapshot.brightness, ticks: eaten.frames };
}

check("Brightness holds, then decays", async () => {
  startPlaying(h);
  // Eight tiles of corridor: the tile the forager rests on, the pellet this point
  // measures, and room for the second eat mid-decay with tiles to spare.
  await poseStraightRun(h, 8);
  // The pellet under the forager is eaten off camera and `G` put back to `0`, so
  // the eat this point measures has its full headroom rather than landing on a
  // `G` already part way to the `1` it clamps at.
  await clearUnderfoot(h);

  const measured = await captureReplay(h, "decay", async () => {
    const first = await eatOne(h);

    // The hold: `G` unchanged from the tick the pellet went to the end of the
    // window.
    const held: { at: number; g: number }[] = [];
    let ticks = 0;
    for (const at of HOLD_READS) {
      await h.advance(at - ticks);
      ticks = at;
      held.push({ at, g: h.snapshot().brightness });
    }

    // The decay: one halving per `BRIGHT_HALFLIFE` from the hold's end.
    const decayed: { halflives: number; g: number }[] = [];
    for (const halflives of [1, 2]) {
      const at = HOLD_TICKS + halflives * HALFLIFE_TICKS;
      await h.advance(at - ticks);
      ticks = at;
      decayed.push({ halflives, g: h.snapshot().brightness });
    }

    // And a further pellet eaten mid-decay, which arms the hold in full again.
    const second = await eatOne(h);
    const rearmed: { at: number; g: number }[] = [];
    ticks = 0;
    for (const at of HOLD_READS) {
      await h.advance(at - ticks);
      ticks = at;
      rearmed.push({ at, g: h.snapshot().brightness });
    }

    return { first, held, decayed, second, rearmed };
  });

  if (measured.first.g <= 0) {
    failPrecondition(
      "eating a plankton to raise G above 0, so there is a brightness to hold " +
        "and decay (specs/sensing.md adds BRIGHT_PER_EAT per plankton)",
      "brightness/from-eating",
      measured.first.g,
    );
  }

  for (const read of measured.held) {
    assertLessThanOrEqual(
      Math.abs(read.g - measured.first.g),
      HOLD_TOLERANCE,
      `G drifted this far from the ${measured.first.g} the eat set it to, ` +
        `read at ${read.at} ticks of the ${HOLD_TICKS}-tick BRIGHT_HOLD ` +
        `window, which G is steady across (specs/sensing.md)`,
    );
  }

  for (const read of measured.decayed) {
    const halved = measured.first.g * 0.5 ** read.halflives;
    assertLessThanOrEqual(
      Math.abs(read.g - halved),
      DECAY_TOLERANCE,
      `G missed the ${halved} it halves to by this much, read ` +
        `${read.halflives} BRIGHT_HALFLIFE (${BRIGHT_HALFLIFE}s) past the ` +
        `hold: G halves every halflife once the hold expires (specs/sensing.md)`,
    );
  }

  for (const read of measured.rearmed) {
    assertLessThanOrEqual(
      Math.abs(read.g - measured.second.g),
      HOLD_TOLERANCE,
      `G drifted this far from the ${measured.second.g} the second eat set it ` +
        `to, read at ${read.at} ticks of the hold that eat arms: eating mid-` +
        `decay arms the hold in full again (specs/sensing.md)`,
    );
  }
});
