// instrumentation/gates-default-on — every one of the four faculty gates is on in
// a game that has just started, and `reset()` puts all four back on.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates: "each is on by default
// and restored to on by `reset`". `specs/state.md` says the same of the state
// itself: "All four are on when a game begins, and the debugging surface poses
// them."
//
// WHY IT IS ITS OWN POINT. Every scenario in this suite that does NOT name a gate
// rests on the four standing on: `openTable` leaves them exactly where `reset`
// put them, so a build whose launching or whose automatic flip started off would
// quietly change the meaning of dozens of checks that never mention it. A grade
// that names the default here is worth more than four grades that name a mechanic.
//
// TWO CHECKS, BECAUSE THE SENTENCE MAKES TWO CLAIMS, and a build can fail either
// one alone.
//
//   - The first reads the game AS IT STARTS, with nothing posed and nothing
//     reset. That is the state a player meets, and it is the half a build whose
//     `reset` is correct but whose initial state is not would otherwise pass. The
//     harness is built with `reset: false` for it, because a reset on the way in
//     would restore exactly the value under test and read it back as a pass.
//   - The second poses all four OFF and resets, so it is a reading of a
//     restoration rather than of a game that had never touched them: a build
//     whose `reset` restores nothing reads back the `false` it was left holding.
//     It asserts the four really went off first, so a build whose gates cannot be
//     posed at all fails saying so rather than passing on a value that never
//     moved.
//
// WHAT THIS DOES NOT DECIDE. What any gate GATES. Each of the four has its own
// point in this group — `auto-flip-gate`, `win-detect-gate`, `launching-gate` and
// `trail-painting-gate` — and a build whose gate reads back correctly while
// gating nothing fails there and not here. The rest of what `reset` restores is
// `instrumentation/reset-restores-title`.

import { afterEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The four gates, under the names `specs/instrumentation.md` gives them. */
const GATES = [
  { pose: "setAutoFlip", field: "autoFlip" },
  { pose: "setWinDetect", field: "winDetect" },
  { pose: "setLaunching", field: "launching" },
  { pose: "setTrailPainting", field: "trailPainting" },
] as const;

/** The four gate fields of a snapshot, read as one comparable tuple. */
type Gates = Record<(typeof GATES)[number]["field"], boolean>;

/** All four at one value: the two states this point compares against. */
function all(value: boolean): Gates {
  return {
    autoFlip: value,
    winDetect: value,
    launching: value,
    trailPainting: value,
  };
}

/**
 * The four gates a snapshot reports, as one tuple.
 *
 * Read together rather than one at a time so a build that gets three of them
 * right NAMES the fourth in the failure rather than reporting a bare `false`.
 */
function gates(snapshot: CascadeSnapshot): Gates {
  return {
    autoFlip: snapshot.autoFlip,
    winDetect: snapshot.winDetect,
    launching: snapshot.launching,
    trailPainting: snapshot.trailPainting,
  };
}

/** One frame, so a still carries the table the reading was taken from. */
const SETTLE_FRAMES = 1;

let h: Harness;

afterEach(async () => {
  await h?.dispose();
});

it("reports every gate on in a game that has just started", async () => {
  // Nothing posed and nothing reset: the game as a player meets it. The clock is
  // stopped either way, so what is read is the state the build chose for itself.
  h = await createHarness({ reset: false });

  const opened = await h.snapshot();

  await h.advance(SETTLE_FRAMES);

  assertDeepEqual(
    gates(opened),
    all(true),
    "the four faculty gates in a game that has just started, before " +
      "anything has been posed and before any reset: each is on by default " +
      "(specs/instrumentation.md, specs/state.md)",
  );
});

it("turns all four faculty gates back on when it resets", async () => {
  h = await createHarness();

  // Every gate away from the value the reset is about to restore.
  for (const gate of GATES) await h.debug[gate.pose](false);

  assertDeepEqual(
    gates(await h.snapshot()),
    all(false),
    "the four faculty gates posed off, read before the reset — a gate that " +
      "would not go off leaves the reset nothing to restore",
  );

  await h.debug.reset();
  // Read with no frame between, so what is read is the reset's own work.
  const title = await h.snapshot();

  await h.advance(SETTLE_FRAMES);
  // Before the assertion, so a failing reset still leaves the picture of the
  // table it returned to.
  await captureStill(h, "reset");

  assertDeepEqual(
    gates(title),
    all(true),
    "the four faculty gates after a reset that followed all four being " +
      "turned off: each is restored to on by reset " +
      "(specs/instrumentation.md)",
  );
});
