// presentation/broken-member-unmistakable — a member this run has broken is
// drawn unmistakably differently from one still carrying.
//
// `specs/overview.md` § Visual design: "… a member at breaking point stands out,
// and A BROKEN MEMBER IS UNMISTAKABLE." `specs/statics.md` fixes what breaking
// is, and `specs/state.md` reports the ids in `run.broken`.
//
// EITHER ANSWER IS CONFORMING. A build may take a broken member out of the
// picture altogether or leave it drawn in a state of its own, and the
// specification chooses neither — so this asks for one or the other: the frame
// either stopped drawing it, or draws it in a colour that stands well clear of
// what an intact member of the same material is drawn in.
//
// NOTHING HERE READS A PALETTE. The comparison is between two things the build
// drew, never against a value of this check's own.

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

/** How far a broken member's colour must stand from an intact one's, of 765. */
const APART = 60;

/** The most ticks driven while waiting for something to break. */
const PATIENCE = 600;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a broken member unmistakably, or stops drawing it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await poseTape(h, TAPE);
  await startRun(h);

  const snapshot = await runUntil(
    h,
    (s) => s.run.broken.length > 0 || s.run.phase !== "running",
    PATIENCE,
  );

  const drawn = await h.drawn();
  await h.capture("broken", "The crane after a member has broken");

  if (snapshot.run.broken.length === 0) return;

  const brokenId = snapshot.run.broken[0]!;
  const broken = entriesOf(drawn, "member").find((e) => e.id === brokenId);
  if (broken === undefined) return; // Taken out of the picture: unmistakable.

  const intact = entriesOf(drawn, "member").filter(
    (entry) => entry.id !== null && !snapshot.run.broken.includes(entry.id),
  );
  assertTrue(
    intact.length > 0,
    "an intact member still drawn, to tell the broken one apart from",
  );
  const nearest = Math.min(
    ...intact.map((entry) => colourDistance(entry.color, broken.color)),
  );
  assertTrue(
    nearest >= APART,
    `a broken member to be drawn unmistakably: member ${brokenId} broke and is ` +
      `still drawn, and its colour stands only ${nearest} of 765 from the ` +
      "nearest intact member's (specs/overview.md)",
  );
});
