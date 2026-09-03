// presentation/broken-member-unmistakable — a member that breaks stops being
// drawn as an intact one.
//
// specs/overview.md § Visual design, the row for utilization: "While the tape
// runs, each member's color reads its utilization on a monotone ramp from slack
// to its limit, a member at breaking point stands out, and A BROKEN MEMBER IS
// UNMISTAKABLE." specs/statics.md § Utilization and breakage: "every member whose
// utilization exceeds `1` breaks: all of them are removed at once, permanently
// for the rest of the run, and they join the run's list of broken members in
// ascending member-id order."
//
// WHICH LEAVES THE BUILD TWO ANSWERS AND ASKS FOR EITHER. A broken member may
// leave the drawing altogether or be drawn in a broken state; what the
// specification fixes is that it is unmistakable, so what is on screen where it
// stood does not go on looking like an intact member.
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with every one of its vertices and the base colour of the material it is drawn
// with. A member is found by WHERE IT RUNS — the object drawn along the segment
// joining its two nodes — and never by a name a build gave it.
//
// SO WHAT IS ASSERTED IS THE COMPARISON THE SENTENCE ASKS FOR: on the tick after
// the break, either nothing is drawn along the broken member's segment at all, or
// what is drawn there is drawn UNLIKE every member the run still carries — a
// different shape, or a colour off the ramp the intact members are on. A build
// that simply left it drawn as before, or drew it at the ramp's top like a member
// at its limit, fails.
//
// AND AN INTACT MEMBER IS READ BESIDE IT, so the reading is about the broken one:
// a member the run still carries is still drawn along its own segment on the same
// tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
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
  type CraneDesign,
  type DrawnObject,
  type Harness,
  type MemberView,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The mast tie left out, which is what puts one member over its capacity. */
const OMITTED = 16;

/** The crane: the smallest one that stands, one tie short, with ballast at the tip. */
const CRANE: CraneDesign = {
  ...MINIMAL_CRANE,
  members: MINIMAL_CRANE.members.filter((_member, index) => index !== OMITTED),
  counterweights: [[4, 4, 0]],
};

/**
 * The tape: turn the grip, slowly, a long way.
 *
 * A run needs a tape (`empty-program` refuses the start, specs/program.md), and
 * this is the one that changes nothing: the grip turns the bare hook and applies
 * "no force to anything" (specs/rigging.md), and a target this far off keeps the
 * step live for far longer than this check watches, so the run neither ends nor
 * moves the crane.
 */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 3600, rate: 1 }] },
];

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

/** How a member is drawn: its shape and its colour, or `null` for nothing. */
function drawingOf(h: Harness, member: MemberView): string | null {
  for (const object of drawnObjects(h)) {
    if (!drawnAlong(object, member.a, member.b)) continue;
    return JSON.stringify([
      object.type,
      object.vertices,
      object.color,
      Math.round(object.box!.size.x * 1000),
      Math.round(object.box!.size.y * 1000),
      Math.round(object.box!.size.z * 1000),
    ]);
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

it("stops drawing a broken member the way it draws the intact ones", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await poseTape(h, TAPE);

  const started = await startRun(h);
  assertTrue(
    started.run.broken.length === 0,
    "no member broken at the run's first tick, since nothing has ticked at " +
      "the call (specs/state.md)",
  );
  assertTrue(
    started.run.axes.grip.rate <= GRIP_MAX_RATE,
    "the grip command this tape carries to be one the editor accepts " +
      "(specs/program.md)",
  );

  const ticked = await runTicks(h, 1);
  await h.capture("broken", "The frame after the break");

  assertGreaterThanOrEqual(
    ticked.run.broken.length,
    1,
    "a member to break on this run's first tick, since the posed crane " +
      "carries one past its capacity (specs/statics.md)",
  );

  const broken = started.structure.members.filter((member) =>
    ticked.run.broken.includes(member.id),
  );
  const intact = started.structure.members.filter(
    (member) => !ticked.run.broken.includes(member.id),
  );
  assertGreaterThanOrEqual(
    intact.length,
    1,
    "a member the run still carries, which is what the broken one's drawing " +
      "is read against",
  );

  // How the run's own members are drawn on this tick: the shapes and colours a
  // player reads as "intact".
  const asIntact = new Set(
    intact
      .map((member) => drawingOf(h, member))
      .filter((drawing): drawing is string => drawing !== null),
  );
  assertGreaterThanOrEqual(
    asIntact.size,
    1,
    "the members the run still carries to be drawn along their own segments " +
      "on the tick a member broke, which is what makes this a comparison " +
      "(specs/ui.md § Build)",
  );

  for (const member of broken) {
    const drawing = drawingOf(h, member);
    assertTrue(
      drawing === null || !asIntact.has(drawing),
      `member ${member.id}, which run.broken names, to stop being drawn the ` +
        "way an intact member is drawn — gone from the picture, or drawn in " +
        "some shape or colour no member the run still carries is drawn in — " +
        'since "a broken member is unmistakable" (specs/overview.md). It is ' +
        `still drawn along its own segment as ${drawing ?? "nothing"}, which ` +
        `is how the run's intact members are drawn`,
    );
  }
});
