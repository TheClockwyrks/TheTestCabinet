// simulation/rail-break-inboard-of-the-trolley — a rail breaking inboard of the
// trolley ends the run as collapse.
//
// specs/statics.md § Utilization and breakage: a rail break takes the track out
// from under the trolley and ends the run as `collapse` when "the trolley is on
// the broken member OR BEYOND IT, its position at or past that member's end
// nearer the track origin". This point is the second half of that clause: the
// trolley is not standing on the rail that breaks, it is standing outboard of it,
// with the break between it and the track's origin.
//
// THE TROLLEY IS POSED TO `9`, which is on the outermost rail over `[8, 10]` and
// a unit past the far end of the middle rail the counterweight breaks. `9` is at
// or past that member's end nearer the origin — `2` — so the rule applies, and it
// applies for the "beyond it" reason rather than the "on it" one, which the
// trolley's own position reads back.
//
// The remaining rails would leave a gap too, so the check reads the trolley's
// position out to say which clause this scenario stands on: a build that only
// implemented the second case of the rule would still fail the check that isolates
// the first, and the two are separate points.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, fail } from "../assert";
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

/** Long Reach: the widest envelope and the budget this crane is built inside. */
const SITE = 3;

/** A tape that keeps the run ticking and touches nothing the solve reads. */
const TURN_THE_GRIP: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 3600, rate: GRIP_MAX_RATE }],
  },
];

/* ---- The crane: a three-rail jib whose middle rail is the one that breaks ---- */
//
// A box tower on the site's four anchors, X-braced on every face, carrying the
// slew ring at `(0, 2, 0)`; a four-headed mast over the top flange, tied to every
// flange node it can reach and stayed back to a short rear arm; and a jib of
// three rails at `y = 4` running out from the flange over the stations
// `x = 0, 2, 8, 10`, paired by a chord of struts at `z = 2` and hung from every
// mast head. A counterweight on the station at `x = 8` is what overloads the
// crane, and the rail it overloads is the long middle one: at `RAIL_MAX_LEN` its
// compression capacity is buckling-reduced to `(4 / 6)^2` of `RAIL_CAP_COMPRESSION`
// (specs/structure.md § Members), while the two-unit rails on either side of it
// keep the whole `2400` — and the innermost rail runs between two top-flange
// nodes, which are the arm solve's supports, so it carries no force at all.

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

/** The stations the jib's two chords run over, in `x`. */
const STATIONS: readonly number[] = [0, 2, 8, 10];

/** The box tower: four legs, the flange square, an X on each face, one top tie. */
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

/** The crane this check poses, built in the order that gives it its ids. */
function jibCrane(): CraneDesign {
  const members: DesignMember[] = [...TOWER];
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
  for (let i = 0; i + 1 < STATIONS.length; i += 1) {
    const [from, to] = [STATIONS[i], STATIONS[i + 1]];
    members.push([[from, 4, 0], [to, 4, 0], "rail"]);
    members.push([[from, 4, 2], [to, 4, 2], "strut"]);
    if (Math.hypot(to - from, 2) <= STRUT_MAX_LEN) {
      members.push([[from, 4, 0], [to, 4, 2], "strut"]);
    }
  }
  for (const x of STATIONS) {
    if (x === 0 || x === 2) continue;
    members.push([[x, 4, 0], [x, 4, 2], "strut"]);
  }
  for (const x of STATIONS) {
    if (x === 0 || x === 2) continue;
    for (const head of HEADS) {
      members.push([head, [x, 4, 0], "cable"]);
      members.push([head, [x, 4, 2], "cable"]);
    }
  }
  return {
    site: 0,
    name: "A three-rail jib with a counterweight at its middle station",
    ring: [0, 2, 0],
    counterweights: [[8, 4, 0]],
    members,
    tape: [],
  };
}

/** The middle rail's two ends: the one the counterweight overloads. */
const MIDDLE_RAIL: readonly [Node, Node] = [
  [2, 4, 0],
  [8, 4, 0],
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

/** On the outermost rail, past the far end of the rail that breaks. */
const BEYOND_THE_MIDDLE_RAIL = 9;

it("ends the run as collapse when a rail inboard of the trolley breaks", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, jibCrane());
  await poseTape(h, TURN_THE_GRIP);

  const { structure } = await h.snapshot();
  const middle = memberAt(structure.members, MIDDLE_RAIL);

  await startRun(h);
  await h.debug.setAxis("trolley", BEYOND_THE_MIDDLE_RAIL);
  const { run } = await runTicks(h, 1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    run.axes.trolley.value,
    BEYOND_THE_MIDDLE_RAIL,
    "the trolley's position along the track: past the middle rail's far end " +
      "at 8, so the trolley stands beyond the member that breaks rather than " +
      "on it (specs/structure.md § The trolley and the rail)",
  );
  assertContains(
    run.broken,
    middle,
    `the members this tick broke to carry the middle rail (id ${middle}), ` +
      "which runs from 2 to 8 and so breaks inboard of the trolley",
  );
  assertEqual(
    run.phase,
    "failed",
    "the run's phase on the tick a rail breaks inboard of the trolley, its " +
      "position at or past that member's end nearer the track origin " +
      "(specs/statics.md § Utilization and breakage)",
  );
  assertEqual(
    run.cause,
    "collapse",
    "the cause a rail breaking inboard of the trolley ends the run with " +
      "(specs/statics.md § The failure causes)",
  );
});
