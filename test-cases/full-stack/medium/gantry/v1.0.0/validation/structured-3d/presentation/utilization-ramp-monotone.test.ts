// presentation/utilization-ramp-monotone — while the tape runs, each member's
// colour reads its utilization on one ramp.
//
// specs/overview.md, "Visual design", the row for utilization: "While the tape
// runs, each member's color reads its utilization on a monotone ramp from slack
// to its limit, a member at breaking point stands out, and a broken member is
// unmistakable." specs/statics.md, "Utilization and breakage": "Utilization is
// the readout the run screen colors members by (specs/ui.md)", and specs/ui.md's
// run screen carries "A legend for the utilization ramp (specs/overview.md), so
// the member coloring reads."
//
// ONE RAMP, THREE MEMBERS. The claim is not that any particular utilization is
// any particular colour — specs/overview.md leaves the palette to the build — but
// that the colours lie on ONE ramp, so a member's colour places it between two
// members it sits between in utilization. That is what is read: three members of
// the same crane, at three utilizations well apart, on one tick of one run. The
// middle one's colour has to be nearer each end than the two ends are to each
// other, which is what "on a ramp between them" means and is true of every ramp
// however it is coloured; and all three have to be far enough apart to read,
// because a ramp nobody can see the steps of is not a readout.
//
// THE THREE ARE CHOSEN BY WHAT THE RUN REPORTS, not written down here. The crane
// is posed, the run started, and `run.forces` — "the latest solve's, in member-id
// order, over the members still intact" — says what each member is carrying; the
// three read are the lowest of the candidates and then the next two at least
// `SEPARATION` above the one before. A validator that named three members and
// their utilizations would be asserting specs/statics.md's arithmetic, which
// belongs to another point.
//
// THE CANDIDATES ARE THE ARM'S LONG MEMBERS, which at this camera pose are drawn
// clear of one another across the upper half of the stage; the tower's are two
// units long and heaped inside one another around the slew ring, where no reading
// can say which member a pixel belongs to. Each colour is read as the biggest
// cluster of agreeing samples along the member, so a sample that landed on
// something crossing in front of it does not become the member's colour.
//
// NOTHING MOVES BUT THE TROLLEY. The tape drives the trolley out along the track,
// which loads the arm without turning it, so every member this point reads stands
// where the build screen drew it. The yard is emptied first: no loads, no
// obstacles, nothing on the hook.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan, assertTrue } from "../assert";
import { TROLLEY_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  drawnObjects,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type DrawnObject,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

const SITE = 0;

/** Two counterweights on the arm, which is what spreads the members' loads. */
const COUNTERWEIGHTS: readonly (readonly [number, number, number])[] = [
  [4, 4, 0],
  [0, 8, 0],
];

/** The tape: drive the trolley to the track's far end, loading the arm. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "trolley", target: 4, rate: TROLLEY_MAX_RATE }],
  },
];

/** How far into the run the colours are read, in ticks. */
const AT_TICK = 80;

/** The camera: the start pose, drawn in close, so the arm fills the stage. */
const CAMERA = { yaw: 45, pitch: 30, dist: 20 } as const;

/** The arm members this point may read: the long ones, drawn clear. */
const CANDIDATES: readonly (readonly [Vec3, Vec3])[] = [
  [
    { x: 2, y: 4, z: 0 },
    { x: 0, y: 8, z: 0 },
  ],
  [
    { x: 0, y: 8, z: 0 },
    { x: 4, y: 4, z: 0 },
  ],
  [
    { x: 2, y: 4, z: 2 },
    { x: 0, y: 8, z: 0 },
  ],
  [
    { x: 0, y: 4, z: 2 },
    { x: 0, y: 8, z: 0 },
  ],
];

/** How far apart in utilization the three read members must stand. */
const SEPARATION = 0.25;

/** How far apart two colours on the ramp must read, out of 441. */
const READS = 50;

/* -------------------------------------------------------------------------- */
/* Reading the picture                                                        */
/* -------------------------------------------------------------------------- */
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with every one of its vertices and the base colour of the material it is drawn
// with. `engine/rendering.md` fixes that the pipeline collects every enabled,
// visible render component on every live actor and draws it, so any build of this
// case that draws a member draws it there.
//
// A MEMBER IS FOUND BY WHERE IT RUNS, never by a name a build gave it: the object
// this reads is the one drawn ALONG the segment joining the member's two nodes —
// every vertex within `OFF_LINE` of that line, reaching both ends and running
// past neither. That is a stronger identification than the engineless project's,
// which samples the middle of the drawn segment and takes the colour most of the
// samples agree on; it does not need the member to be on the stage at all, so the
// camera pose is not part of this reading.

/** A colour read off the picture, each channel 0-255. */
type Rgb = readonly [number, number, number];

/** How far apart two colours are, on the 0-441 (`sqrt(3) * 255`) scale. */
function apart(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** How far a drawing may lie off the segment it is drawn along, in units. */
const OFF_LINE = 0.25;

/** Whether `object` is drawn along the segment `from`-`to`, and only there. */
function drawnAlong(object: DrawnObject, from: Vec3, to: Vec3): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const span = Math.hypot(dx, dy, dz);
  if (span === 0) return false;
  const slack = OFF_LINE / span;
  let least = Infinity;
  let most = -Infinity;
  for (const point of object.points()) {
    const t =
      ((point.x - from.x) * dx +
        (point.y - from.y) * dy +
        (point.z - from.z) * dz) /
      (span * span);
    const on = { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t };
    if (Math.hypot(point.x - on.x, point.y - on.y, point.z - on.z) > OFF_LINE) {
      return false;
    }
    least = Math.min(least, t);
    most = Math.max(most, t);
  }
  return (
    least !== Infinity &&
    least <= slack &&
    least >= -slack &&
    most >= 1 - slack &&
    most <= 1 + slack
  );
}

/** The colour the member between `from` and `to` is drawn in, or `null`. */
function memberColour(h: Harness, from: Vec3, to: Vec3): Rgb | null {
  for (const object of drawnObjects(h)) {
    if (!drawnAlong(object, from, to)) continue;
    const hex = object.color;
    if (hex === null || !/^#[0-9a-f]{6}$/i.test(hex)) continue;
    return [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ];
  }
  return null;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("colours three members of one run onto a single utilization ramp", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, { ...MINIMAL_CRANE, counterweights: COUNTERWEIGHTS });
  await poseTape(h, TAPE);
  await h.debug.setCamera(CAMERA.yaw, CAMERA.pitch, CAMERA.dist);
  await startRun(h);
  const running = await runTicks(h, AT_TICK);
  assertTrue(
    running.run.phase === "running",
    `the run still in progress ${AT_TICK} ticks in, which is when this point ` +
      "reads the member colouring (specs/program.md)",
  );

  // What each candidate is carrying, and where it is drawn.
  const read: { load: number; from: Vec3; to: Vec3 }[] = [];
  for (const [from, to] of CANDIDATES) {
    const member = running.structure.members.find(
      (m) =>
        (m.a.x === from.x &&
          m.a.y === from.y &&
          m.a.z === from.z &&
          m.b.x === to.x &&
          m.b.y === to.y &&
          m.b.z === to.z) ||
        (m.b.x === from.x &&
          m.b.y === from.y &&
          m.b.z === from.z &&
          m.a.x === to.x &&
          m.a.y === to.y &&
          m.a.z === to.z),
    );
    assertTrue(
      member !== undefined,
      `the member between (${from.x}, ${from.y}, ${from.z}) and (${to.x}, ` +
        `${to.y}, ${to.z}) to stand in the posed crane (specs/structure.md)`,
    );
    const force = running.run.forces.find((f) => f.id === member!.id);
    assertTrue(
      force !== undefined,
      `a utilization reported for member ${member!.id}, which is intact, ` +
        "since run.forces carries every intact member (specs/statics.md)",
    );
    read.push({ load: force!.utilization, from, to });
  }

  // The lowest, and then the next two at least SEPARATION above the one before.
  const ordered = [...read].sort((one, two) => one.load - two.load);
  const chosen = [ordered[0]!];
  for (const candidate of ordered) {
    if (candidate.load - chosen[chosen.length - 1]!.load >= SEPARATION) {
      chosen.push(candidate);
    }
  }
  assertTrue(
    chosen.length >= 3,
    `three of the crane's arm members at utilizations at least ` +
      `${SEPARATION} apart ${AT_TICK} ticks into this run, which is the ` +
      "spread this point reads a ramp over; the candidates carry " +
      `${ordered.map((c) => c.load.toFixed(3)).join(", ")}`,
  );
  const [low, middle, high] = chosen as [
    (typeof chosen)[0],
    (typeof chosen)[0],
    (typeof chosen)[0],
  ];

  await h.capture("ramp", "Three members at three utilizations");

  const colours = [low, middle, high].map((member) =>
    memberColour(h, member.from, member.to),
  );
  for (const [index, colour] of colours.entries()) {
    assertTrue(
      colour !== null,
      `a colour read along the member carrying ` +
        `${[low, middle, high][index]!.load.toFixed(3)}, which the run screen ` +
        "colours by its utilization (specs/ui.md)",
    );
  }
  const [slack, between, loaded] = colours as [Rgb, Rgb, Rgb];

  const ends = apart(slack, loaded);
  const lower = apart(slack, between);
  const upper = apart(between, loaded);

  for (const [what, gap] of [
    [`${low.load.toFixed(2)} and ${middle.load.toFixed(2)}`, lower],
    [`${middle.load.toFixed(2)} and ${high.load.toFixed(2)}`, upper],
    [`${low.load.toFixed(2)} and ${high.load.toFixed(2)}`, ends],
  ] as const) {
    assertGreaterThan(
      gap,
      READS,
      `the members carrying ${what} to be drawn in colours a player can tell ` +
        "apart, since each member's colour reads its utilization on a ramp " +
        "from slack to its limit (specs/overview.md)",
    );
  }

  assertLessThan(
    lower,
    ends,
    `the member carrying ${middle.load.toFixed(2)} to be drawn nearer the one ` +
      `carrying ${low.load.toFixed(2)} than the two ends of the run are to ` +
      "each other, since it sits between them on one ramp (specs/overview.md)",
  );
  assertLessThan(
    upper,
    ends,
    `the member carrying ${middle.load.toFixed(2)} to be drawn nearer the one ` +
      `carrying ${high.load.toFixed(2)} than the two ends are to each other, ` +
      "since it sits between them on one ramp (specs/overview.md)",
  );
});
