// screens/fail-copy-ring-overload — a ring connection past its cap is read out as
// THE SLEW RING GAVE WAY.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `ring-overload` the copy `THE SLEW RING GAVE
// WAY`. This check decides that one row of that table, and no other.
//
// THE CRANE IS AN OVERHANGING JIB, AND ITS OWN COUNTERWEIGHTS ARE THE LOAD.
// specs/statics.md § The two solves: the arm is supported on the four top-flange
// nodes, "Each corner carries the reaction at its top-flange node down to its
// bottom-flange node, so the force at a corner's two flange connections has one
// magnitude. That magnitude is checked against `RING_CAP` at each of the four
// corners... a tick on which one exceeds it ends the run as `ring-overload`."
//
// Two counterweights hang at the jib's tip, `TIP_RADIUS` from the slew axis. Each
// weighs `COUNTERWEIGHT_MASS * GRAVITY`, so the arm hands the ring an overturning
// couple of some `24000` force-units, and the flange square that has to carry it
// is `LATTICE_PITCH` (`2`) across — so a corner sees far more than `RING_CAP`
// (`6000`) while the crane stands still, before the tape has moved anything.
//
// WHY THIS CRANE RATHER THAN A HEAVY LIFT. The hoist cable snaps past
// `HOIST_CABLE_CAP` (`3000`), which caps what a lift can hand the ring, and the
// snap is stage 4 of a tick while the ring check is stage 6 (specs/program.md § The
// tick pipeline) — so a load heavy enough to overload the ring would end the run as
// `cable-snap` first. The crane's own counterweights are subject to no such cap.
//
// WHY THE ARM HOLDS TOGETHER LONG ENOUGH TO REPORT IT. specs/statics.md fixes the
// order within the tick: "the arm solve, whose singularity is a `collapse`; then
// the ring check on the arm's reactions, whose excess is a `ring-overload`; then
// the tower solve... Only when all three pass are utilizations read and breakage
// decided." The arm solve is regular here — the mast ties every flange node to
// every node of the level above it, so no node is a mechanism — and the ring check
// is reached before the tower is solved and before any member's utilization is
// read, which is what makes the ring the cause rather than one of several.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import {
  COUNTERWEIGHT_MASS,
  GRAVITY,
  GRIP_MAX_RATE,
  LATTICE_PITCH,
  RING_CAP,
  FAIL_TEXT,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runUntil,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type LatticeNode,
  type TapeStepSpec,
} from "../harness";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";

/** The cause this check drives the run to. */
const CAUSE = "ring-overload" as const;

/** Site 4, whose envelope takes the jib and whose budget takes the crane. */
const SITE = 3;

/** The tip's horizontal distance from the slew axis, which is at (1, ·, 1). */
const TIP_RADIUS = Math.hypot(16 - 1, 0 - 1);

const ANCHORS: readonly LatticeNode[] = [
  [0, 0, 0],
  [2, 0, 0],
  [0, 0, 2],
  [2, 0, 2],
];

/** The ring is based at (0, 2, 0): its flanges are the squares at y 2 and y 4. */
const RING_BASE: LatticeNode = [0, 2, 0];
const BOTTOM_FLANGE: readonly LatticeNode[] = [
  [0, 2, 0],
  [2, 2, 0],
  [0, 2, 2],
  [2, 2, 2],
];
const TOP_FLANGE: readonly LatticeNode[] = [
  [0, 4, 0],
  [2, 4, 0],
  [0, 4, 2],
  [2, 4, 2],
];

/** The mast's two levels above the top flange. */
const MAST_LOW: readonly LatticeNode[] = [
  [0, 8, 0],
  [2, 8, 0],
  [0, 8, 2],
  [2, 8, 2],
];
const MAST_HIGH: readonly LatticeNode[] = [
  [0, 12, 0],
  [2, 12, 0],
  [0, 12, 2],
  [2, 12, 2],
];

/** The mast head the jib hangs from, on each side of the arm. */
const HEAD_NEAR: LatticeNode = [0, 12, 0];
const HEAD_FAR: LatticeNode = [0, 12, 2];

/** The jib's stations along the track, out to the tip. */
const STATIONS = [0, 4, 8, 12, 16] as const;
const TIP = STATIONS[STATIONS.length - 1];

/**
 * Every member between two levels of four nodes.
 *
 * The whole sixteen rather than one leg a corner: the reaction at a flange node
 * is "minus the sum of the applied force there and every member force pulling on
 * it" (specs/statics.md), so spreading the path over four members leaves each of
 * them carrying a quarter of what the corner carries, and the arm holds together
 * while the corner runs past its cap.
 */
function fan(
  lower: readonly LatticeNode[],
  upper: readonly LatticeNode[],
): DesignMember[] {
  return lower.flatMap((a) => upper.map((b): DesignMember => [a, b, "strut"]));
}

/** A square level, braced in its own plane. */
function braced(level: readonly LatticeNode[]): DesignMember[] {
  const [a, b, c, d] = level as readonly [
    LatticeNode,
    LatticeNode,
    LatticeNode,
    LatticeNode,
  ];
  return [
    [a, b, "strut"],
    [c, d, "strut"],
    [a, c, "strut"],
    [b, d, "strut"],
    [a, d, "strut"],
  ];
}

/** The jib: a rail chord, a strut chord beside it, and the lacing between. */
function jib(): DesignMember[] {
  const out: DesignMember[] = [];
  for (let i = 0; i + 1 < STATIONS.length; i += 1) {
    const near = STATIONS[i] as number;
    const far = STATIONS[i + 1] as number;
    out.push([[near, 4, 0], [far, 4, 0], "rail"]);
    out.push([[near, 4, 2], [far, 4, 2], "strut"]);
    out.push([[far, 4, 0], [far, 4, 2], "strut"]);
    out.push([[near, 4, 0], [far, 4, 2], "strut"]);
  }
  for (const station of STATIONS.slice(1)) {
    out.push([HEAD_NEAR, [station, 4, 0], "cable"]);
    out.push([HEAD_FAR, [station, 4, 2], "cable"]);
  }
  out.push([HEAD_NEAR, [TIP, 4, 2], "cable"]);
  out.push([HEAD_FAR, [TIP, 4, 0], "cable"]);
  return out;
}

/** A tower, a ring, a two-level mast, and a jib with its tip weighed down. */
const OVERHUNG: CraneDesign = {
  site: SITE + 1,
  name: "Overhung jib",
  ring: RING_BASE,
  counterweights: [
    [TIP, 4, 0],
    [TIP, 4, 2],
  ],
  members: [
    ...fan(ANCHORS, BOTTOM_FLANGE),
    ...braced(BOTTOM_FLANGE),
    ...fan(TOP_FLANGE, MAST_LOW),
    ...braced(MAST_LOW),
    ...fan(MAST_LOW, MAST_HIGH),
    ...braced(MAST_HIGH),
    ...jib(),
  ],
  tape: [],
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

it("reads a ring connection past its cap out as THE SLEW RING GAVE WAY", async () => {
  assertGreaterThan(
    (2 * COUNTERWEIGHT_MASS * GRAVITY * TIP_RADIUS) / LATTICE_PITCH,
    RING_CAP,
    "the couple the tip's counterweights hand the ring, carried across a " +
      "flange square two units wide, against the cap a ring connection " +
      "carries (specs/statics.md)",
  );

  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, OVERHUNG);
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
  await h.capture("fail-copy", "the run screen after the slew ring gave way");

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
