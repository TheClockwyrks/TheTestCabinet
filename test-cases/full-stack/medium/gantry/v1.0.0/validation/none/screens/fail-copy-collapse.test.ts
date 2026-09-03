// screens/fail-copy-collapse — a structure that cannot stand is read out as THE
// STRUCTURE COLLAPSED.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `collapse` the copy `THE STRUCTURE COLLAPSED`.
// This check decides that one row of that table, and no other.
//
// THE CRANE IS THE MINIMAL ONE WITH THE TIP'S ONE OUT-OF-PLANE TIE LEFT OFF.
// specs/statics.md § Singularity: "A singular solve, in either the arm or the
// tower, at any point in the slack-cable iteration or the breakage sequence, ends
// the run as `collapse`. An under-braced 3D truss is the ordinary way to get
// here: a flat frame with nothing resisting out-of-plane motion is a mechanism
// even though every member is sound." Without the tie from the mast head to the
// rail tip, every member reaching the tip lies in the `y = 4` plane, so the tip
// has no stiffness at all in `y`: the arm solve's supported system has a zero
// pivot there and is singular.
//
// It is the ONE member left off, and the crane is otherwise the harness's minimal
// crane, so the structure is still ready — it keeps its ring, its rail, and a
// member path from every node to the flange (specs/structure.md § Readiness) — and
// the run starts rather than being refused. The tape is a `grip` move, the one
// axis whose motion "applies no force to anything" (specs/rigging.md § The grip),
// so nothing the tape does contributes to the verdict: the collapse is the first
// tick's own solve.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { GRIP_MAX_RATE, FAIL_TEXT } from "../constants";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runUntil,
  startRun,
  type CraneDesign,
  type Harness,
  type LatticeNode,
  type TapeStepSpec,
} from "../harness";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";

/** The cause this check drives the run to. */
const CAUSE = "collapse" as const;

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/** The mast head and the rail tip: the tie that holds the tip up in `y`. */
const TIE: readonly [LatticeNode, LatticeNode] = [
  [0, 8, 0],
  [4, 4, 0],
];

/** Two lattice nodes are the same node. */
function sameNode(a: LatticeNode, b: LatticeNode): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** The minimal crane, less that one tie: ready, and a mechanism. */
const UNTIED: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, with the tip's out-of-plane tie left off",
  members: MINIMAL_CRANE.members.filter(
    ([a, b]) =>
      !(
        (sameNode(a, TIE[0]) && sameNode(b, TIE[1])) ||
        (sameNode(a, TIE[1]) && sameNode(b, TIE[0]))
      ),
  ),
};

/** A move that turns the bare hook, which applies no force to anything. */
const TURN_THE_HOOK: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 90, rate: GRIP_MAX_RATE }],
};

/**
 * Every run of text the last frame drew on the screen layer.
 *
 * specs/overview.md fixes where a readout lives — "over it the screen-space
 * readouts are drawn on a 2D layer composited on top of the picture, laid out in
 * logical stage units" — so the words a screen shows are the runs of text that
 * layer's frame issued, whatever font, colour, or arrangement a build chose for
 * them.
 */
async function screenText(harness: Harness): Promise<string[]> {
  const ops = (await harness.page.evaluate(() =>
    (window as unknown as Record<string, { last(): unknown[] }>)[
      "__tcabRec"
    ]!.last(),
  )) as RecordedOp[];
  return drawnText(ops.map(toDrawCall));
}

/** The copy this check is about. */
const COPY = FAIL_TEXT[CAUSE];

/** The nine it must not be confused with. */
const OTHER_COPY = Object.entries(FAIL_TEXT).filter(
  ([cause]) => cause !== CAUSE,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads a singular solve out as THE STRUCTURE COLLAPSED", async () => {
  assertLength(
    UNTIED.members,
    MINIMAL_CRANE.members.length - 1,
    "the members left once the tip's one out-of-plane tie is dropped: this " +
      "check is about the crane WITHOUT that tie and no other change to it",
  );

  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, UNTIED);
  await poseTape(h, [TURN_THE_HOOK]);

  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    20,
    "the run to end",
  );
  // The frame that FOLLOWS the tick that ended it: a failed run "stays here, the
  // scene as it stood, with the failure copy below shown plainly"
  // (specs/ui.md § Run), and nothing ticks under the reading.
  await h.advance(1);
  await h.capture("fail-copy", "the run screen after the structure collapsed");

  assertEqual(
    ended.run.cause,
    CAUSE,
    "the cause the scenario failed the run with (specs/statics.md)",
  );

  const shown = (await screenText(h)).join(" | ");
  if (!shown.toUpperCase().includes(COPY)) {
    fail(
      `the copy \`FAIL_TEXT\` gives \`${CAUSE}\`, "${COPY}" ` +
        "(specs/ui.md § The failure copy)",
      shown,
    );
  }
  const confused = OTHER_COPY.filter(([, copy]) =>
    shown.toUpperCase().includes(copy),
  );
  if (confused.length > 0) {
    fail(
      `"${COPY}" and no other cause's copy (specs/ui.md § The failure copy)`,
      `it also shows the copy of ${confused.map(([cause]) => cause).join(", ")}`,
    );
  }
});
