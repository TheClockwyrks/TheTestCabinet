// screens/select-entry-carries-the-site-opening — confirming a site's row on the
// select screen is a site OPENING, not just a screen change.
//
// specs/ui.md § Site select: "`confirm` on an open or cleared site enters it,
// opening the `build` screen with that site's stored structure and tape."
// specs/instrumentation.md says the same from the surface's side, of the
// operation that stands for it: "`openSite` carries the effects `specs/state.md`
// states for opening a site and then shows the `build` screen; the two together
// are what entering a site from the select screen does (`specs/ui.md`)."
//
// And specs/state.md § What a site opening does enumerates the effects: "Opening
// a site sets the site index, keeps that site's stored structure and tape, fills
// the open site with copies of that site's loads and obstacles, empties the undo
// history, clears the pending node and the shown check result, returns the camera
// to its start pose, and returns the run to its idle placeholder."
//
// So this check makes every one of those effects VISIBLE before the entry and
// reads them all after it. On the site it is about, it builds a crane (which
// fills the undo history), writes a tape, runs the check action (which leaves a
// result on the build screen), holds a pending first node, orbits the camera off
// its start pose, empties the yard of the loads and the obstacle specs/sites.md
// gives the site, and runs the tape to a failure (which leaves the run anything
// but idle). Confirming the site's row has to undo every one of those, and leave
// the structure and the tape it was built with standing.
//
// THE SITE IS THE THIRD, because it is the first that carries an obstacle as well
// as a load (specs/sites.md § Site 3), and refilling both is part of the
// operation. Reaching it needs it open — "`confirm` on a locked site does
// nothing" — so the two sites before it are posed as cleared, which is what
// "the site at index `n + 1` opens once the site at index `n` is cleared" asks
// for.
//
// Only the entry itself is driven as a player drives it: the highlight is posed
// on the row and `confirm` pressed, because what `confirm` on a row does is the
// requirement.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  BINDINGS,
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  SITES,
} from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Site 3, the first site carrying an obstacle beside its load. */
const SITE = 2;
const AUTHORED = SITES[SITE]!;

/** A camera pose that is not the start pose, inside the orbit's own limits. */
const ORBITED = { yaw: 200, pitch: 55, dist: 30 };

/** A node of the crane, held as the pending first end of the next member. */
const PENDING = { x: 0, y: 4, z: 0 };

/** One action, which fails the run at once on an emptied yard. */
const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the whole site opening, not just the screen", async () => {
  // The two sites before it cleared, so the row this check confirms is open.
  await h.debug.setCleared(0, true);
  await h.debug.setCleared(1, true);

  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [ATTACH]);
  // The check action, which is the only thing that leaves a result on screen,
  // and it is run after the tape so the tape does not clear it again.
  await h.press(BINDINGS.check[0]!);
  await h.debug.setPendingNode(PENDING.x, PENDING.y, PENDING.z);
  await h.debug.setCamera(ORBITED.yaw, ORBITED.pitch, ORBITED.dist);

  await startRun(h);
  const before = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    60,
    "the run to end",
  );

  // Everything a site opening undoes, standing undone.
  assertEqual(before.run.phase, "failed", "the run this check leaves behind");
  assertGreaterThan(
    before.historyDepth,
    0,
    "the undo history the crane's edits left",
  );
  assertNotNull(before.pendingNode, "the pending first node the check holds");
  assertNotNull(before.checkResult, "the check result the check action left");
  assertEqual(before.camera.yaw, ORBITED.yaw, "the camera the check orbited");
  assertLength(before.site.loads, 0, "the loads the check emptied out");
  assertLength(before.site.obstacles, 0, "the obstacles the check emptied out");

  const built = before.structure.members.length;
  const written = before.program.length;
  assertGreaterThan(built, 0, "the members the check built");
  assertGreaterThan(written, 0, "the steps the check wrote");

  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(SITE);
  await h.press(BINDINGS.confirm[0]!);
  await h.advance(1);
  await h.capture("entered", "the build screen the select entry opened");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "build",
    "the screen entering a site opens (specs/ui.md § Site select)",
  );
  assertEqual(after.siteIndex, SITE, "the site the entry opened");
  assertEqual(
    after.historyDepth,
    0,
    "the undo history a site opening empties (specs/state.md)",
  );
  assertNull(
    after.pendingNode,
    "the pending node a site opening clears (specs/state.md)",
  );
  assertNull(
    after.checkResult,
    "the check result a site opening clears (specs/state.md)",
  );
  assertEqual(
    after.camera.yaw,
    CAMERA_START_YAW,
    "the yaw a site opening returns the camera to (specs/state.md)",
  );
  assertEqual(
    after.camera.pitch,
    CAMERA_START_PITCH,
    "the pitch a site opening returns the camera to (specs/state.md)",
  );
  assertEqual(
    after.camera.dist,
    CAMERA_START_DIST,
    "the distance a site opening returns the camera to (specs/state.md)",
  );
  assertLength(
    after.site.loads,
    AUTHORED.loads.length,
    "the loads a site opening fills the site with (specs/state.md, " +
      "specs/sites.md)",
  );
  assertEqual(
    after.site.loads[0]?.mass,
    AUTHORED.loads[0]?.mass,
    "the authored load the site is filled with again",
  );
  assertLength(
    after.site.obstacles,
    AUTHORED.obstacles.length,
    "the obstacles a site opening fills the site with (specs/state.md, " +
      "specs/sites.md)",
  );
  assertEqual(
    after.site.obstacles[0]?.min.x,
    AUTHORED.obstacles[0]?.min.x,
    "the authored obstacle the site is filled with again",
  );
  assertEqual(
    after.run.phase,
    "idle",
    "the run a site opening puts back (specs/state.md)",
  );
  assertLength(
    after.structure.members,
    built,
    "the site's stored structure, which a site opening keeps (specs/state.md)",
  );
  assertLength(
    after.program,
    written,
    "the site's stored tape, which a site opening keeps (specs/state.md)",
  );
});
