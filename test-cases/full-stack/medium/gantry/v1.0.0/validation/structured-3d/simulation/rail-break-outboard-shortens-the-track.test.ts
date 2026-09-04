// simulation/rail-break-outboard-shortens-the-track — a rail breaking outboard of
// the trolley does not end the run.
//
// specs/statics.md § Utilization and breakage, closing the rail-break rule: "A
// BREAK OUTBOARD OF THE TROLLEY SIMPLY SHORTENS THE TRACK, and the trolley axis's
// range shortens with it". The rule it is the exception to ends the run only when
// "the trolley is on the broken member or beyond it, its position at or past that
// member's end nearer the track origin", so a trolley standing short of that end
// is outside both cases; and the sentence before it says what a breakage that
// leaves the structure standing does instead: it "plays the `break` cue and the
// run continues without the broken members".
//
// THE CRANE IS BUILT SO THAT THE ONLY MEMBER THAT BREAKS IS THE OUTERMOST RAIL
// AND WHAT IS LEFT STILL STANDS. Three rails run out over the stations
// `x = 0, 2, 4, 10` from a tower on Heavy Haul's nine anchors; a counterweight
// at the far station `x = 10` loads them, and the outermost rail is the long one,
// at `RAIL_MAX_LEN` its compression capacity buckling-reduced to `(4 / 6)^2` of
// `RAIL_CAP_COMPRESSION` (specs/structure.md § Members) while the shorter rails
// inboard of it keep the whole `2400`. So the outermost rail is the member that
// goes past utilization `1`. The far station is held by three struts back to the
// jib as well as by its hanger cables, so losing the rail leaves it standing
// rather than hanging on cables alone.
//
// THE TROLLEY IS LEFT WHERE THE RUN STARTS IT. specs/program.md § The axes:
// "Every run starts from the same posture: ... `trolley` `0`, the track origin",
// which is short of the outermost rail's near end at `4`, so this scenario poses
// no axis at all. What is left of the track is the two rails over `[0, 4]`, which
// still meet end to end at distinct radii from the slew axis, so the run carries
// on with a shorter track.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertNull, fail } from "../assert";
import { GRIP_MAX_RATE, STRUT_MAX_LEN } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type MemberView,
  type TapeStepSpec,
} from "../harness";

/** Heavy Haul: nine anchors, so the tower carries the overhung counterweight. */
const SITE = 5;

/** A tape that keeps the run ticking and touches nothing the solve reads. */
const TURN_THE_GRIP: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 3600, rate: GRIP_MAX_RATE }],
  },
];

/* ---- The crane: a three-rail jib whose OUTERMOST rail is the weak one ------- */

/** A lattice node. */
type Node = readonly [number, number, number];

/** The distance between two lattice nodes. */
const span = (a: Node, b: Node): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The ring's four top-flange nodes, which the arm is supported on. */
const FLANGE: readonly Node[] = [
  [0, 4, 0],
  [2, 4, 0],
  [0, 4, 2],
  [2, 4, 2],
];

/** The mast's four heads, over the flange and clear of the jib in `z`. */
const HEADS: readonly Node[] = [
  [0, 8, 2],
  [0, 8, -2],
  [2, 8, 2],
  [2, 8, -2],
];

/** The rear arm the mast is stayed back to. */
const REAR: readonly Node[] = [
  [-2, 4, 0],
  [-2, 4, 2],
];

/**
 * The struts that hold the far station once its rail is gone: two below the jib
 * and one above it, spanning three directions between them, and every one of them
 * a strut rather than a cable, so nothing there can go slack.
 */
const PROPS: readonly Node[] = [
  [8, 2, 2],
  [8, 2, -2],
  [8, 6, 0],
];

/** The box tower on the site's inner four anchors, X-braced on every face. */
const TOWER: readonly DesignMember[] = [
  [[0, 0, 0], [0, 2, 0], "strut"],
  [[2, 0, 0], [2, 2, 0], "strut"],
  [[0, 0, 2], [0, 2, 2], "strut"],
  [[2, 0, 2], [2, 2, 2], "strut"],
  [[0, 2, 0], [2, 2, 0], "strut"],
  [[0, 2, 2], [2, 2, 2], "strut"],
  [[0, 2, 0], [0, 2, 2], "strut"],
  [[2, 2, 0], [2, 2, 2], "strut"],
  [[0, 0, 0], [2, 2, 0], "strut"],
  [[2, 0, 0], [2, 2, 2], "strut"],
  [[2, 0, 2], [0, 2, 2], "strut"],
  [[0, 0, 2], [0, 2, 0], "strut"],
  [[2, 0, 0], [0, 2, 0], "strut"],
  [[2, 0, 2], [2, 2, 0], "strut"],
  [[0, 0, 2], [2, 2, 2], "strut"],
  [[0, 0, 0], [0, 2, 2], "strut"],
  [[0, 2, 0], [2, 2, 2], "strut"],
];

/** The braces to the site's five outer anchors, which widen the tower's base. */
const SPLAY: readonly DesignMember[] = [
  [[4, 0, 0], [2, 2, 0], "strut"],
  [[4, 0, 0], [2, 2, 2], "strut"],
  [[4, 0, 2], [2, 2, 2], "strut"],
  [[4, 0, 2], [2, 2, 0], "strut"],
  [[4, 0, 4], [2, 2, 2], "strut"],
  [[0, 0, 4], [0, 2, 2], "strut"],
  [[0, 0, 4], [2, 2, 2], "strut"],
  [[2, 0, 4], [2, 2, 2], "strut"],
  [[2, 0, 4], [0, 2, 2], "strut"],
];

/** The crane this check poses, built in the order that gives it its ids. */
function proppedJib(): CraneDesign {
  const members: DesignMember[] = [...TOWER, ...SPLAY];
  for (const head of HEADS) {
    for (const node of FLANGE) {
      if (span(head, node) <= STRUT_MAX_LEN)
        members.push([node, head, "strut"]);
    }
  }
  for (let i = 0; i < HEADS.length; i += 1) {
    for (let j = i + 1; j < HEADS.length; j += 1) {
      const [one, other] = [HEADS[i], HEADS[j]];
      if (span(one, other) <= STRUT_MAX_LEN)
        members.push([one, other, "strut"]);
    }
  }
  members.push(
    [[0, 4, 0], REAR[0], "strut"],
    [[0, 4, 2], REAR[1], "strut"],
    [REAR[0], REAR[1], "strut"],
    [REAR[0], [0, 4, 2], "strut"],
  );
  for (const head of HEADS) {
    for (const node of REAR) {
      if (span(head, node) <= STRUT_MAX_LEN)
        members.push([head, node, "strut"]);
    }
  }
  // The track: two short rails from the flange, then the long outer one.
  members.push(
    [[0, 4, 0], [2, 4, 0], "rail"],
    [[2, 4, 0], [4, 4, 0], "rail"],
    [[4, 4, 0], [10, 4, 0], "rail"],
  );
  // The station at `x = 4`, framed back to the flange and hung from the mast.
  members.push(
    [[2, 4, 2], [4, 4, 2], "strut"],
    [[4, 4, 0], [4, 4, 2], "strut"],
    [[2, 4, 0], [4, 4, 2], "strut"],
    [[4, 4, 0], [2, 4, 2], "strut"],
    [[4, 4, 0], [0, 4, 2], "strut"],
    [[4, 4, 2], [0, 4, 0], "strut"],
  );
  for (const head of HEADS) {
    members.push([head, [4, 4, 0], "cable"]);
    members.push([head, [4, 4, 2], "cable"]);
  }
  // The far station, hung from every head and propped back to the jib.
  for (const head of HEADS) members.push([head, [10, 4, 0], "cable"]);
  for (const prop of PROPS) {
    members.push([prop, [10, 4, 0], "strut"]);
    for (const node of [
      [4, 4, 0],
      [4, 4, 2],
      [2, 4, 0],
    ] as readonly Node[]) {
      if (span(prop, node) <= STRUT_MAX_LEN)
        members.push([prop, node, "strut"]);
    }
  }
  for (let i = 0; i < PROPS.length; i += 1) {
    for (let j = i + 1; j < PROPS.length; j += 1) {
      const [one, other] = [PROPS[i], PROPS[j]];
      if (span(one, other) <= STRUT_MAX_LEN)
        members.push([one, other, "strut"]);
    }
  }
  return {
    site: 0,
    name: "A three-rail jib with a counterweight beyond its outermost rail",
    ring: [0, 2, 0],
    counterweights: [[10, 4, 0]],
    members,
    tape: [],
  };
}

/** The outermost rail's two ends: the long one the counterweight overloads. */
const OUTER_RAIL: readonly [Node, Node] = [
  [4, 4, 0],
  [10, 4, 0],
];

/** The id the pose gave the member joining those two nodes. */
function memberAt(
  members: readonly MemberView[],
  ends: readonly [Node, Node],
): number {
  const wanted = new Set(ends.map((node) => node.join(",")));
  const found = members.find(
    (member) =>
      wanted.has(`${member.a.x},${member.a.y},${member.a.z}`) &&
      wanted.has(`${member.b.x},${member.b.y},${member.b.z}`),
  );
  if (found === undefined) {
    fail(
      `the crane to carry a member from (${ends[0].join(", ")}) to ` +
        `(${ends[1].join(", ")})`,
      `${members.length} members, none of them joining those two nodes`,
    );
  }
  return found.id;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the run on when a rail outboard of the trolley breaks", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, proppedJib());
  await poseTape(h, TURN_THE_GRIP);

  const { structure } = await h.snapshot();
  const outer = memberAt(structure.members, OUTER_RAIL);

  await startRun(h);
  const { run } = await runTicks(h, 1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    run.axes.trolley.value,
    0,
    "the trolley's position, left where the run starts it at the track " +
      "origin (specs/program.md § The axes), short of the broken rail's end " +
      "nearer that origin at 4",
  );
  assertContains(
    run.broken,
    outer,
    `the members this tick broke to carry the outermost rail (id ${outer}), ` +
      "the one this break is about",
  );
  assertEqual(
    run.phase,
    "running",
    "the run's phase on a tick whose only breakage is outboard of the " +
      "trolley, which simply shortens the track " +
      "(specs/statics.md § Utilization and breakage)",
  );
  assertNull(
    run.cause,
    "the failure a break outboard of the trolley carries: none, the run " +
      "continues without the broken member",
  );
});
