// collisions/anchor-mounts-collide-with-nothing — an anchor mount standing inside
// an obstacle raises nothing.
//
// `specs/statics.md` § Collisions closes the list of bodies with a table, and the
// second row of it names what is tested against nothing: "The cable, the trolley,
// the slew ring, the counterweights, THE ANCHOR MOUNTS, waiting loads, and placed
// loads | Nothing". The sentence above it is just as firm: "Those three are the
// whole of it" — the member test, the carried load's, and the ground.
//
// So a mount is scenery. `specs/world.md` § Anchors gives it its place in the
// world — "lattice nodes on the ground where the structure is fixed to the earth"
// — and a site fixes its anchors whether or not the crane uses them all. A build
// that tested the mount's own body would end a run for a mount that stands where a
// block was authored, which the specification never asks for.
//
// THE SCENARIO PUTS ONE MOUNT INSIDE A BOX AND THE CRANE NOWHERE NEAR IT. Heavy
// Haul is the site with nine anchors (`specs/sites.md`), and the minimal crane
// stands on four of them, so `(4, 0, 4)` carries a mount and no member. The
// obstacle is the box `x 3..5`, `y -0.5..1.5`, `z 3..5`, which holds that node
// strictly inside on all three axes. Every member of the crane stands at `z <= 2`,
// outside the box's `z 3..5`, so nothing that IS tested against obstacles is
// anywhere near it — and the check reads the anchor off the site rather than
// assuming it, so the scenario is the one the requirement names.
//
// The tape turns the grip at the slowest legal rate and nothing else, so the arm
// never sweeps, the yard holds no load, and the bare hook hangs two units above
// the ground, well clear of the one test it is subject to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertTrue } from "../assert";
import {
  addOneObstacle,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Heavy Haul, the site whose anchor grid reaches past the minimal crane. */
const SITE = 5;

/** The anchor the box is posed around: one the minimal crane leaves bare. */
const ANCHOR = { x: 4, y: 0, z: 4 };

/** The box `x 3..5`, `y -0.5..1.5`, `z 3..5`, holding that anchor inside it. */
const OBSTACLE_MIN = { x: 3, y: -0.5, z: 3 };
const OBSTACLE_SIZE = { x: 2, y: 2, z: 2 };

/** The slowest legal turn of the grip: it holds the run open and moves nothing. */
const HOLD_RATE = 0.001;
const HOLD_TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 360, rate: HOLD_RATE }] },
];

/** Half a second of run clock with the mount standing inside the box. */
const TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises nothing for an anchor mount standing inside an obstacle", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneObstacle(h, OBSTACLE_MIN, OBSTACLE_SIZE);
  await poseTape(h, HOLD_TAPE);

  const started = await startRun(h);

  // The scenario the requirement is about, read off the site rather than assumed:
  // this site really does carry an anchor at that node.
  assertTrue(
    started.site.anchors.some(
      (one) => one.x === ANCHOR.x && one.y === ANCHOR.y && one.z === ANCHOR.z,
    ),
    `the anchor at (${ANCHOR.x}, ${ANCHOR.y}, ${ANCHOR.z}) the box is posed ` +
      "around (specs/sites.md)",
  );
  assertTrue(
    started.structure.members.every((m) => m.a.z <= 2 && m.b.z <= 2),
    "every member of the crane standing at z <= 2, outside the box's z 3..5, " +
      "so no body that IS tested against obstacles can reach inside it",
  );

  const held = await runTicks(h, TICKS);

  await h.capture(
    "mount",
    "The anchor mount standing inside the obstacle, the run carrying on",
  );

  assertEqual(
    held.run.phase,
    "running",
    `the run after ${TICKS} ticks with an anchor mount standing strictly ` +
      "inside an obstacle: the anchor mounts are tested against nothing " +
      "(specs/statics.md)",
  );
  assertNull(held.run.cause, "the cause of a run nothing tested raised");
});
