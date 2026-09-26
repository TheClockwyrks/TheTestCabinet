// audio/playable-while-muted — muting is a change to what is heard and to
// nothing else.
//
// THE RULE. `specs/ui.md`, Audio, closes the muting paragraph with it: "The game
// stays fully playable with sound muted." Sound is one of the effects
// `specs/assets.md` fixes, which "are drawn over the frame, and nothing they do
// reaches the simulation" (`specs/instrumentation.md`, A render-free core); the
// mute bit is the runtime's, which the game only mirrors
// (`specs/instrumentation.md`: "`muted` is untouched; the runtime owns muting").
// So a machine played muted owes the run its rules fix, cycle for cycle and
// metric for metric.
//
// THE CONFIGURATION is one delivery, made by a machine that actually carries it.
// The challenge is a `target` of `TARGET_MIN` (`1`), whose reagent and product are both one
// unbonded `sol` (`specs/formats.md` requires only that `target` is "at least
// `1`"). The machine is a `set` for that product on the hex the delivery lands
// on, and one `arm` beside it whose tape is `grab`, `rotate-cw`, `drop` — so the
// run grabs a mote, sweeps it one step clockwise, releases it on the set's
// footprint, and the set consumes it. The three cycles that takes exercise a
// fetch, a grab, a carried motion with its collision samples, a drop, the sigil
// phase, the set, the area bank and the completion test, which is the whole of
// what "playable" names here.
//
// THE ORDER OF A CYCLE IS WHY THE THIRD ONE COMPLETES IT. `specs/simulation.md`:
// a cycle runs "Fetch ... Drops ... Grabs ... Motion ... Boundary", and a set
// accepts a constellation only "when it is unheld" (`specs/sigils.md`). So cycle
// `0` grabs, cycle `1` carries the mote onto the footprint while it is still
// held, and cycle `2` opens the gripper before its boundary, where "After the
// rises, if every set's tally has reached the challenge's `target`, the run
// completes: the status becomes `complete` and the metrics are recorded".
//
// WHAT THE RULES FIX FOR THAT RUN, which is what the muted run is held to. "A
// completing or faulting boundary leaves `sim.cycle` at the cycle just run", so
// `2`; `cycles` is "`sim.cycle + 1` at the completing boundary", so `3`; `cost`
// is "the machine's cost, as `specs/parts.md` computes it", one arm and one set
// out of `PART_COSTS`; and `area` is the bank: "at the start of the run it takes
// every hex of every placed part ... and every gripper hex at rest", which is the
// set's one footprint hex, the arm's anchor and its gripper hex, and every
// boundary after adds "the hex of every mote and of every gripper", all of which
// are those same three hexes, so `3`. The set's tally stands at `1`.
//
// THE MUTE BIT IS POSED WITH THE RUN PAUSED, so posing it costs the run nothing.
// The action is a real key press, which is the only way to move the bit at all,
// and a press runs a frame; "The fraction advances only while the status is
// `running`" (`specs/simulation.md`), so a paused run is where a check may press
// a key as many or as few times as the bit needs without the run seeing game
// time it was not given. The press also happens AFTER the run is standing, so no
// `reset` falls between it and the drive.
//
// THE VERDICT. The muted run reaches `sim.status` `complete`, still muted, on
// the cycle the rules fix, with the metrics and the tally they fix. Only whole
// numbers are read: `sim.fraction` is a running sum whose figures "agree to
// within the rounding of that sum rather than bit for bit"
// (`specs/instrumentation.md`), so it is no part of the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  ARM_MIN_LEN,
  ONE_DELIVERY_AREA,
  ONE_DELIVERY_CYCLES,
  PART_COSTS,
  TARGET_MIN,
} from "../constants";
import { at, rotateAbout } from "../field";
import { armPart, setPart, solution } from "../formats";
import { ONE_DELIVERY } from "../fixtures";
import { gripperHex } from "../parts";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openRun,
  pressAction,
  resumeRun,
  spawnMote,
  tallyOf,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The arm's anchor, one step north of the delivery hex. */
const ARM = at(0, -1);

/** Its gripper hex at rest: length `ARM_MIN_LEN` along spoke `0` (`specs/parts.md`). */
const GRABBED_AT = gripperHex(ARM, 0, ARM_MIN_LEN);

/** Where one clockwise turn about the anchor puts that gripper. */
const DELIVERED_TO = rotateAbout(GRABBED_AT, ARM, 1);

/** The whole machine: the set the delivery lands on, and the arm that makes it. */
const MACHINE = solution([
  setPart(0, DELIVERED_TO.q, DELIVERED_TO.r),
  armPart("arm", ARM.q, ARM.r, 0, ARM_MIN_LEN, ["grab", "rotate-cw", "drop"]),
]);

/** Cycles from the run's start to the boundary that completes it. */
const CYCLES = ONE_DELIVERY_CYCLES;

/** What the rules fix for that run, all of it whole numbers. */
const EXPECTED = {
  status: "complete",
  cycle: CYCLES - 1,
  metrics: {
    cost: PART_COSTS.arm + PART_COSTS.set,
    cycles: CYCLES,
    area: ONE_DELIVERY_AREA,
  },
  tallies: [TARGET_MIN],
};

/** The same reading off a snapshot, in the terms `EXPECTED` is written in. */
function outcome(snapshot: OrrerySnapshot): unknown {
  const sim = snapshot.sim;
  return {
    status: sim?.status,
    cycle: sim?.cycle,
    metrics: sim?.metrics,
    tallies: sim?.tallies,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose the run, put the mute bit where `muted` says, and play it to its end. */
async function play(muted: boolean): Promise<OrrerySnapshot> {
  await openRun(h, {
    challenge: ONE_DELIVERY,
    machine: MACHINE,
    paused: true,
  });
  if ((await h.snapshot()).muted !== muted) await pressAction(h, "mute");
  assertEqual(
    (await h.snapshot()).muted,
    muted,
    `the mute action poses the runtime's bit ${muted ? "ON" : "OFF"} for this run`,
  );

  await spawnMote(h, GRABBED_AT, "sol");
  await resumeRun(h);
  await advanceCycles(h, CYCLES);
  return h.snapshot();
}

/** Read that a run really made its delivery, rather than merely agreeing. */
function assertDelivered(snapshot: OrrerySnapshot, at_: string): void {
  assertNotNull(snapshot.sim, `${at_}: the run is still reported at its end`);
  assertEqual(
    snapshot.sim?.status,
    "complete",
    `${at_}: the carried mote reached the set and the run completed`,
  );
  assertEqual(
    tallyOf(snapshot, 0),
    1,
    `${at_}: the set consumed the delivered product, which is what completed it`,
  );
  assertNotNull(
    snapshot.sim?.metrics ?? null,
    `${at_}: a completed run records its metrics`,
  );
}

it("reaches the completion and the metrics the rules fix while muted", async () => {
  const silent = await captureReplay(h, "muted-run", () => play(true));
  assertDelivered(silent, "muted");
  assertEqual(
    silent.muted,
    true,
    "the muted run was still muted when it completed",
  );

  assertDeepEqual(
    outcome(silent),
    EXPECTED,
    "the machine completes on the cycle its tape fixes, with the cost, cycles, area and tally the rules fix, muted",
  );
});
