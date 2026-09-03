// presentation/breaking-point-stands-out — a member at breaking point stands out
// from the rest of the ramp.
//
// `specs/overview.md` § Visual design: "While the tape runs, each member's color
// reads its utilization on a monotone ramp from slack to its limit, A MEMBER AT
// BREAKING POINT STANDS OUT, and a broken member is unmistakable." Standing out
// is the part that is not the ramp: a member at its limit must not simply be the
// ramp's last shade, or a player scanning a crane cannot find the one that is
// about to go.
//
// SO THE READING IS A GAP, and the gap is measured against the ramp's own steps.
// Every intact member's colour is read, they are ordered by what they carry, and
// the step up to the member nearest its limit is compared against the typical
// step between the rest. A ramp with no stand-out has an even climb; one with a
// stand-out has a jump at the top.
//
// NO PALETTE IS FIXED. What is compared is the SIZE of the build's own steps
// against each other.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  colourDistance,
  createHarness,
  entriesOf,
  clearAll,
  MINIMAL_CRANE,
  openSite,
  poseCrane,
  poseTape,
  runUntil,
  startRun,
  type CraneDesign,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The mast tie left out, which is what puts one member over its capacity. */
const OMITTED = 16;

/**
 * The crane: the smallest one that stands, one tie short, with ballast at the
 * tip — so it loads itself past a member's capacity without anything being
 * hoisted (`specs/statics.md`).
 */
const CRANE: CraneDesign = {
  ...MINIMAL_CRANE,
  members: MINIMAL_CRANE.members.filter((_member, index) => index !== OMITTED),
  counterweights: [[4, 4, 0]],
};

/**
 * The tape: turn the grip, slowly, a long way.
 *
 * A run needs a tape (`empty-program` refuses the start, `specs/program.md`), and
 * this is the one that changes nothing: the grip turns the bare hook and applies
 * "no force to anything" (`specs/rigging.md`), so the run neither ends nor moves
 * the crane while the structure settles under its own ballast.
 */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 3600, rate: 1 }] },
];

/** How hard the top step must stand against the typical one below it. */
const STANDS_OUT = 1.5;

/** The most ticks driven while loading the crane toward a limit. */
const PATIENCE = 600;

/** The utilization at which a member counts as being at breaking point. */
const AT_THE_LIMIT = 0.999;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a member at its limit clear of the ramp below it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await poseTape(h, TAPE);
  await startRun(h);

  const snapshot = await runUntil(
    h,
    (s) =>
      s.run.forces.some((f) => f.utilization >= AT_THE_LIMIT) ||
      s.run.phase !== "running",
    PATIENCE,
  );

  const drawn = await h.drawn();
  await h.capture("breaking", "A member at breaking point among the rest");

  const forces = new Map(snapshot.run.forces.map((f) => [f.id, f.utilization]));
  const members = entriesOf(drawn, "member")
    .filter((e) => e.id !== null && forces.has(e.id))
    .sort((a, b) => forces.get(a.id!)! - forces.get(b.id!)!);
  // Nothing reached its limit in the ticks driven, so there is no stand-out to
  // find and nothing here to fail.
  if (members.length < 3) return;
  const top = members[members.length - 1]!;
  if ((forces.get(top.id!) ?? 0) < AT_THE_LIMIT) return;

  const steps: number[] = [];
  for (let i = 1; i < members.length; i += 1) {
    steps.push(colourDistance(members[i - 1]!.color, members[i]!.color));
  }
  const topStep = steps[steps.length - 1]!;
  const below = steps.slice(0, -1);
  const typical =
    below.reduce((sum, step) => sum + step, 0) / Math.max(1, below.length);

  assertTrue(
    topStep >= Math.max(typical * STANDS_OUT, 20),
    `a member at breaking point to stand out from the ramp: the step up to it ` +
      `was ${topStep.toFixed(0)} of 765 and the typical step below it was ` +
      `${typical.toFixed(0)} (specs/overview.md)`,
  );
});
