// screens/solved-panel-appears-on-complete — the solved panel is up while the run
// is COMPLETE, and only then.
//
// THE RULE. "While `sim.status` is `complete`, a panel is drawn over the run
// showing `SOLVED_TITLE_TEXT` (`CHALLENGE COMPLETE`), the finished run's three
// metrics, the challenge's records with any new best marked, and a vertical menu
// built from `SOLVED_ITEMS`" (`specs/ui.md`, The solved panel). The status is
// what puts it there: `specs/ui.md` introduces the two panels as "drawn over
// [the editor] while a run is in the matching status", and the other status has
// its own display — "While `sim.status` is `faulted`, the field shows the machine
// frozen at the cycle the fault stopped ... and a banner". So a run that is
// `running`, `paused` or `faulted` has no solved panel over it.
//
// WHAT COUNTS AS THE PANEL. Its own copy, which `specs/ui.md` fixes and no other
// part of the editor shows: the heading `SOLVED_TITLE_TEXT`, and the two menu
// items every panel offers — `NEXT CHALLENGE` "is offered only when the mode has
// a challenge after this one", while `KEEP TINKERING` and `BACK TO SELECT` are
// always there. That copy is read off the frame's text operations because
// `specs/assets.md` says that is where it comes from: under What stays drawn in
// code, "The title, howto, and select screens, the solved panel, and all text"
// are drawn by the build and "No produced file covers" them. What the panel's
// menu is and what order it is in are their own items; this one reads the panel's
// presence.
//
// THE POSE. Two worlds, one for the three statuses without a panel and one for
// the status with it.
//
// The first is a challenge asking for ONE delivery of a lone `sol`, with one
// `set` standing alone on the field: read while `running` straight after the run
// starts, and again while `paused`, which `setPaused` poses without any key. Its
// tally is `0`, so nothing completes under it.
//
// Then a lone `sol` is spawned on the set's footprint and one cycle is run: the
// set takes it, the tally reaches the challenge's `target` of `1`, and the run
// completes. A challenge loaded through the surface is one "`specs/ui.md`" covers
// explicitly — its panel "never offers `NEXT CHALLENGE`" and is a panel like any
// other otherwise.
//
// The second world is a bare run holding one `arm` whose tape reads `extend`,
// which `specs/simulation.md` faults as `impossible` — "`extend` or `retract` on
// a part that is not a piston" — at the fetch of cycle `0`. That is the cheapest
// `faulted` run there is: no motion, no motes, nothing to collide.
//
// THE VERDICT. The frame drawn while `complete` carries the panel's heading and
// both of its always-offered menu items; the frames drawn while `running`,
// `paused` and `faulted` carry none of the three.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { drewText } from "../case-harness/text";
import { ARM_MIN_LEN, SOLVED_ITEMS, SOLVED_TITLE_TEXT } from "../constants";
import { armPart, setPart, solution } from "../formats";
import { BARE, ONE_DELIVERY, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  openRun,
  pauseRun,
  resumeRun,
  spawnMote,
  type Harness,
} from "../harness";

/** The whole machine of the completing world: one set, at the origin. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

/** The whole machine of the faulting world: one arm told to `extend`. */
const IMPOSSIBLE = solution([
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, ["extend"]),
]);

/** The panel's copy that is on it whatever the mode holds after this challenge. */
const ALWAYS_SHOWN: readonly string[] = [
  SOLVED_TITLE_TEXT,
  SOLVED_ITEMS[1],
  SOLVED_ITEMS[2],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the solved panel while the run is complete, and not while it is running, paused or faulted", async () => {
  await openRun(h, { challenge: ONE_DELIVERY, machine: ONE_SET });
  await h.advance(1);
  const running = await h.snapshot();
  const runningCalls = await h.lastCalls();

  await pauseRun(h);
  await h.advance(1);
  const paused = await h.snapshot();
  const pausedCalls = await h.lastCalls();
  await resumeRun(h);

  await spawnMote(h, ORIGIN, "sol");
  await advanceCycles(h, 1);
  await h.advance(1);
  const complete = await h.snapshot();
  const completeCalls = await h.lastCalls();
  await captureStill(h, "panel");

  await openBareRun(h, { challenge: BARE, machine: IMPOSSIBLE });
  await advanceCycles(h, 1);
  await h.advance(1);
  const faulted = await h.snapshot();
  const faultedCalls = await h.lastCalls();

  assertNotNull(running.sim, "the first world's run is live from the start");
  assertEqual(
    running.sim?.status,
    "running",
    "the run is running while the first frame is read, one delivery short of its target",
  );
  assertEqual(
    paused.sim?.status,
    "paused",
    "the run is paused while the second frame is read",
  );
  assertEqual(
    complete.sim?.status,
    "complete",
    "the set takes the sol resting on it, the tally reaches the challenge's " +
      "target of 1, and the run completes",
  );
  assertEqual(
    faulted.sim?.status,
    "faulted",
    "an arm told to extend faults, so the fourth frame is read over a faulted run",
  );

  for (const copy of ALWAYS_SHOWN) {
    assertTrue(
      drewText(completeCalls, copy),
      `the panel drawn over the completed run shows ${JSON.stringify(copy)}`,
    );
  }
  for (const [status, calls] of [
    ["running", runningCalls],
    ["paused", pausedCalls],
    ["faulted", faultedCalls],
  ] as const) {
    for (const copy of ALWAYS_SHOWN) {
      assertTrue(
        !drewText(calls, copy),
        `no solved panel is drawn over a ${status} run, so the frame does not ` +
          `show ${JSON.stringify(copy)}`,
      );
    }
  }
});
