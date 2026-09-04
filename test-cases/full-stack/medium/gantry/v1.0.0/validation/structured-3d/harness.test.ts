// harness — the self-test of the machinery every validator in this project
// stands on.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the HARNESS, on the
// counts a suite can never check for itself.
//
// THE COMPOUND SEQUENCES. The debug surface is atomic by design
// (`specs/instrumentation.md`: "a caller that wants several things arranged makes
// several calls"), so opening a site on an empty yard, standing a crane up,
// appending a tape and starting a run are each several operations in a fixed
// order, and every one of them lives in `harness.ts`. Five hundred suites are
// about to be written on top of those sequences, so each one is driven here
// against a build and read back: `poseCrane` really does place every member in
// the order that gives it its id, `poseTape` really does append the steps it was
// handed and leave the screen where it found it, `startRun` really does refuse to
// carry on when the start was refused. A sequence that quietly arranged something
// other than what its name says would not fail here or there — it would make five
// hundred suites measure the wrong thing and pass.
//
// THE LIFTED OPERATIONS. `advance`, `project` and the five input verbs reach a
// validator as members of the harness, and under THIS engine none of them is a
// debug operation at all: each is the engine's own machinery, driven from here.
// So this file is the only place that checks that `advance(n)` runs exactly `n`
// ticks and leaves the watch speed alone, that a key event dispatched at the
// engine reaches the game as the action `specs/controls.md` binds it to, that
// `press` holds the key across a tick, that `click` makes a click rather than an
// orbit drag, and that `project` answers through the camera as it stands.
//
// AND THE HOST. Three things the engine expects a browser to supply are supplied
// by `validation/host.ts` instead, and two of them are load-bearing for every
// item in the project rather than for one: the produced files under `assets/`
// have to answer a `fetch`, and a `.wav` has to decode, or a build that awaits
// its loads in `initialize` never initializes and the whole run goes undecided.
// Both are checked here, on the build, at the top of the file.
//
// No review item names this file, so a run never loads it. It runs with the whole
// project, which is how a case author runs these suites while writing them:
//
//   npx vitest run --config validation/vitest.config.ts

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  assertBetween,
  assertClose,
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertNull,
  assertTrue,
} from "./assert";
import {
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  CUES,
  HOIST_MAX_RATE,
  HOIST_START,
  RUN_SPEEDS,
  SITE_COUNT,
  SITE_NAMES,
  STAGE_H,
  STAGE_W,
  TROLLEY_MAX_RATE,
  UNBOUND_KEY,
} from "./constants";
import {
  DESIGNS,
  GANTRY_DEBUG_VERSION,
  MINIMAL_CRANE,
  REQUIRED_OPS,
  addOneLoad,
  addOneObstacle,
  clearAll,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "./harness";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/** Where this file's own outputs land, inside that directory. */
const SUITE_DIR = join("validation", "harness.test.ts");

/**
 * The operations `specs/instrumentation.md` puts on the surface under `none` and
 * NOT under this engine, because here the engine owns the clock, the camera and
 * the keyboard: "the surface carries no operation for any of them".
 */
const ENGINELESS_ONLY_OPS = [
  "setAutoStep",
  "advance",
  "project",
  "pointerMove",
  "pointerDown",
  "pointerUp",
  "keyDown",
  "keyUp",
] as const;

/** A tape that moves one axis a short way: enough to make a run tick. */
const SHORT_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/* -------------------------------------------------------------------------- */
/* The surface, and what opening a harness leaves                             */
/* -------------------------------------------------------------------------- */

it("reaches a surface carrying every operation the specification requires", async () => {
  assertNull(
    h.surfaceFault,
    "engine.debug carries every operation specs/instrumentation.md names",
  );
  const { version, ops } = h.probe(REQUIRED_OPS);
  assertEqual(version, GANTRY_DEBUG_VERSION, "the surface's `version`");
  for (const name of REQUIRED_OPS) {
    assertEqual(ops[name], "function", `engine.debug.${name}`);
  }
});

it("reaches a surface carrying none of the operations this engine owns", async () => {
  // The other half of the same requirement, and the one only this engine's
  // project can state: the clock, the projection and the raw input belong to the
  // engine here, so a surface carrying an operation for any of them is answering
  // a question the specification did not ask it.
  const { ops } = h.probe(ENGINELESS_ONLY_OPS);
  for (const name of ENGINELESS_ONLY_OPS) {
    assertEqual(
      ops[name],
      "undefined",
      `engine.debug.${name}, which belongs to the engine under this engine`,
    );
  }
});

it("loads every produced file the build asked the engine for", async () => {
  // NOT A CLAIM ABOUT THE BUILD'S ASSETS — that is what the asset suites are for.
  // It is a claim about the HARNESS: `validation/host.ts` answers the engine's
  // asset fetches out of the workspace and decodes a `.wav` through a stub
  // context, and if either stopped working every check in the project would fail
  // on a build that is perfectly good. So the reading is taken once, here, where
  // the fault it would otherwise wear can be named.
  assertLength(
    h.assetFailures,
    0,
    `the produced files the engine could not load: ` +
      h.assetFailures.map((one) => `${one.path} (${one.reason})`).join(", "),
  );
});

it("opens on the title screen, at the reset values", async () => {
  // What the BUILD stood the game up in, read before this harness reset it:
  // `specs/ui.md` says "The game opens on `title`", which is a fact about a fresh
  // game rather than about a reset.
  assertNotNull(h.openingSnapshot, "the opening snapshot the harness read");
  assertEqual(
    h.openingSnapshot?.screen,
    "title",
    "the screen the build opens on",
  );

  const s = await h.snapshot();
  assertEqual(s.version, GANTRY_DEBUG_VERSION, "snapshot().version");
  assertEqual(s.screen, "title", "the screen a reset leaves");
  assertEqual(s.menuIndex, 0, "menuIndex after a reset");
  assertEqual(s.siteIndex, 0, "siteIndex after a reset");
  assertLength(s.cleared, SITE_COUNT, "cleared, one per site");
  assertLength(s.best, SITE_COUNT, "best, one per site");
  assertTrue(
    s.cleared.every((one) => one === false),
    "every site uncleared after a reset",
  );
  assertTrue(
    s.best.every((one) => one === null),
    "every site with no recorded score after a reset",
  );
  assertEqual(s.tool, "strut", "the tool a reset leaves");
  assertNull(s.pendingNode, "the pending node a reset leaves");
  assertEqual(s.historyDepth, 0, "historyDepth after a reset");
  assertEqual(s.camera.yaw, CAMERA_START_YAW, "the camera's start yaw");
  assertEqual(s.camera.pitch, CAMERA_START_PITCH, "the camera's start pitch");
  assertEqual(s.camera.dist, CAMERA_START_DIST, "the camera's start distance");
  assertNull(s.checkResult, "the check result a reset leaves");
  assertEqual(s.run.phase, "idle", "the run a reset leaves");
  assertLength(s.run.loads, 0, "the idle placeholder's load entries");
  assertEqual(s.simTime, 0, "simTime after a reset");
});

it("holds the game still until a check advances it", async () => {
  // Nothing the wall clock does reaches the game: this project drives the engine
  // with `engine.advance` alone and never calls `engine.run`, so no frame runs
  // except the ones a check asks for. `simTime` "accumulates every update's delta
  // time in seconds, whatever the screen", so it is exactly the reading that
  // would move if a frame ran behind the check's back.
  const before = (await h.snapshot()).simTime;
  const framesBefore = h.tick();
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  assertEqual(
    (await h.snapshot()).simTime,
    before,
    "simTime while nothing has advanced the engine",
  );
  assertEqual(h.tick(), framesBefore, "the frames the engine ran on its own");
});

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

it("runs exactly the ticks a check asks for, and leaves the watch speed alone", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, SHORT_TAPE);
  const started = await startRun(h);
  assertEqual(started.run.tick, 0, "run.tick immediately after the start");
  assertEqual(started.run.speedIndex, 0, "the speed index a run starts at");

  const after = await runTicks(h, 10);
  assertEqual(after.run.tick, 10, "run.tick after ten ticks");
  assertEqual(
    after.run.speedIndex,
    0,
    "the speed index the harness left, so a tick is a tick of RUN_SPEEDS[0]",
  );
  assertEqual(RUN_SPEEDS[0], 1, "RUN_SPEEDS[0], which advance() counts in");
  assertEqual(
    after.run.time,
    after.run.tick / 60,
    "the run clock, tick / TICK_HZ",
  );
});

it("drives the same run to the same place twice", async () => {
  // The whole surface rests on this: "Gantry uses no randomness anywhere, and a
  // run advances only on its fixed tick, so the same structure and the same tape
  // produce the same run, tick for tick, every time."
  const drive = async (harness: Harness): Promise<string> => {
    await openSite(harness, 0);
    await emptyYard(harness);
    await standMinimalCrane(harness);
    await poseTape(harness, SHORT_TAPE);
    await startRun(harness);
    const s = await runTicks(harness, 40);
    return JSON.stringify([s.run.axes.hoist, s.run.bob, s.run.pivot]);
  };
  const once = await drive(h);
  const other = await createHarness();
  try {
    assertEqual(await drive(other), once, "the same run, driven twice");
  } finally {
    await other.dispose();
  }
});

/* -------------------------------------------------------------------------- */
/* Posing a world                                                             */
/* -------------------------------------------------------------------------- */

it("opens a site onto the build screen, carrying that site's own yard", async () => {
  await openSite(h, 2);
  const s = await h.snapshot();
  assertEqual(s.screen, "build", "the screen openSite leaves showing");
  assertEqual(s.siteIndex, 2, "the site openSite opened");
  assertEqual(s.site.name, SITE_NAMES[2], "the open site's name");
  assertGreaterThan(
    s.site.obstacles.length,
    0,
    "the obstacles site 3 carries (specs/sites.md)",
  );
  assertEqual(s.historyDepth, 0, "the undo history a site opening empties");
  assertEqual(s.run.phase, "idle", "the run a site opening puts back");
});

it("empties the yard without touching what is built", async () => {
  await openSite(h, 2);
  await standMinimalCrane(h);
  const built = (await h.snapshot()).structure.members.length;
  await emptyYard(h);
  const s = await h.snapshot();
  assertLength(s.site.loads, 0, "the loads emptyYard removes");
  assertLength(s.site.obstacles, 0, "the obstacles emptyYard removes");
  assertEqual(
    s.structure.members.length,
    built,
    "the members emptyYard leaves standing",
  );
});

it("clears the world whole: yard, structure and tape", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await poseTape(h, SHORT_TAPE);
  await clearAll(h);
  const s = await h.snapshot();
  assertLength(s.site.loads, 0, "the loads clearAll removes");
  assertLength(s.site.obstacles, 0, "the obstacles clearAll removes");
  assertLength(s.structure.members, 0, "the members clearAll removes");
  assertNull(s.structure.ring, "the ring clearAll removes");
  assertLength(s.program, 0, "the tape clearAll empties");
  assertEqual(
    s.structure.nextMemberId,
    0,
    "the next member id clearStructure returns to 0",
  );
  assertEqual(s.screen, "build", "the screen clearAll leaves the check on");
});

it("stands the minimal crane up, ready and stable, on every site", async () => {
  for (let site = 0; site < SITE_COUNT; site += 1) {
    await openSite(h, site);
    await emptyYard(h);
    await standMinimalCrane(h);
    const result = await h.check();
    assertLength(
      result.issues.filter((one) => one !== "empty-program"),
      0,
      `site ${site}: the readiness issues of the minimal crane`,
    );
    assertTrue(result.stable, `site ${site}: the minimal crane stands`);
    assertGreaterThan(
      result.members.length,
      0,
      `site ${site}: a standing structure reports its members`,
    );
  }
});

it("poses a crane in the order that gives every member its id", async () => {
  // `designs.json` is keyed by index: "Posing a site's members in this order
  // gives each the member id its index here, which is what every force readout is
  // keyed by." A pose that reordered or dropped one would renumber the rest.
  await openSite(h, 0);
  await emptyYard(h);
  const design = DESIGNS[0]!;
  await poseCrane(h, design);
  const { structure } = await h.snapshot();
  assertLength(
    structure.members,
    design.members.length,
    "the members the reference crane poses",
  );
  assertEqual(
    structure.nextMemberId,
    design.members.length,
    "the id the next member would take",
  );
  assertNotNull(structure.ring, "the ring the reference crane places");
  assertLength(
    structure.counterweights,
    design.counterweights.length,
    "the counterweights the reference crane places",
  );
  for (const [index, [a, b, material]] of design.members.entries()) {
    const member = structure.members.find((one) => one.id === index);
    assertNotNull(member, `the member carrying id ${index}`);
    assertEqual(member?.material, material, `member ${index}'s material`);
    const ends = new Set([
      `${member?.a.x},${member?.a.y},${member?.a.z}`,
      `${member?.b.x},${member?.b.y},${member?.b.z}`,
    ]);
    assertTrue(
      ends.has(`${a[0]},${a[1]},${a[2]}`) &&
        ends.has(`${b[0]},${b[1]},${b[2]}`),
      `member ${index}'s two nodes`,
    );
  }
});

it("fails the check when an edit of a posed crane was refused", async () => {
  // A refusal is silent by design, so the only way a scenario learns its crane
  // lost a member is that the pose says so. An obstacle standing over the tower
  // refuses every member that reaches through it.
  await openSite(h, 0);
  await emptyYard(h);
  await addOneObstacle(h, { x: -1, y: 0, z: -1 }, { x: 6, y: 10, z: 6 });
  await expect(poseCrane(h, MINIMAL_CRANE)).rejects.toThrow(/Expected:/);
});

it("appends a tape step by step and leaves the screen where it found it", async () => {
  await openSite(h, 0);
  const tape: readonly TapeStepSpec[] = [
    {
      kind: "move",
      commands: [
        { axis: "trolley", target: 2, rate: TROLLEY_MAX_RATE },
        { axis: "hoist", target: 4, rate: HOIST_MAX_RATE },
      ],
    },
    { kind: "action", action: "attach" },
  ];
  await poseTape(h, tape);
  const s = await h.snapshot();
  assertEqual(s.screen, "build", "the screen poseTape put back");
  assertLength(s.program, 2, "the steps poseTape appended");
  const first = s.program[0];
  assertEqual(first?.kind, "move", "the first step's kind");
  if (first?.kind === "move") {
    assertLength(first.commands, 2, "the commands the first step carries");
    assertContains(
      first.commands.map((one) => one.axis),
      "trolley",
      "the axes the first step commands",
    );
    assertContains(
      first.commands.map((one) => one.axis),
      "hoist",
      "the axes the first step commands",
    );
  }
  const second = s.program[1];
  assertEqual(second?.kind, "action", "the second step's kind");

  // And it APPENDS: a second call adds to what stands rather than replacing it.
  await poseTape(h, [{ kind: "action", action: "release" }]);
  assertLength((await h.snapshot()).program, 3, "the tape after a second pose");
});

it("holds exactly one load, and exactly one obstacle", async () => {
  await openSite(h, 5);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: 6, y: 2, z: 0, yaw: 0 },
    { x: -6, y: 2, z: 0, yaw: 90 },
  );
  await addOneObstacle(h, { x: 8, y: 0, z: -1 }, { x: 2, y: 4, z: 2 });
  const s = await h.snapshot();
  assertLength(s.site.loads, 1, "the loads addOneLoad leaves");
  assertEqual(s.site.loads[0]?.class, "crate", "the load's class");
  assertEqual(s.site.loads[0]?.mass, 40, "the load's mass");
  assertEqual(s.site.loads[0]?.from.x, 6, "where the load starts");
  assertEqual(s.site.loads[0]?.to.x, -6, "the pad the load is wanted on");
  assertEqual(s.site.loads[0]?.to.yaw, 90, "the yaw the load is wanted at");
  assertLength(s.site.obstacles, 1, "the obstacles addOneObstacle leaves");
  assertEqual(s.site.obstacles[0]?.min.x, 8, "the obstacle's minimum corner");
  assertEqual(s.site.obstacles[0]?.size.y, 4, "the obstacle's size");
});

/* -------------------------------------------------------------------------- */
/* Running                                                                    */
/* -------------------------------------------------------------------------- */

it("fails the check when a run it asked for was refused", async () => {
  // An empty tape refuses the start (`empty-program`), and the refusal is silent:
  // "A refused start leaves the player where they were." A scenario that read the
  // idle placeholder's zeros as a simulation result would grade nothing.
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await expect(startRun(h)).rejects.toThrow(/empty-program/);
});

it("sweeps a tick at a time and fails the check on its cap", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, SHORT_TAPE);
  await startRun(h);
  const hoisted = await runUntil(
    h,
    (s) => s.run.axes.hoist.value >= HOIST_START + 2 - 1e-9,
    600,
    "the hoist to reach its commanded target",
  );
  assertGreaterThan(hoisted.run.tick, 0, "the ticks the sweep ran");

  await expect(
    runUntil(h, () => false, 5, "a condition nothing can meet"),
  ).rejects.toThrow(/within 5 ticks/);
});

/* -------------------------------------------------------------------------- */
/* The lifted operations, which are the engine's here                         */
/* -------------------------------------------------------------------------- */

it("delivers a key press the game can see, on the screen it is showing", async () => {
  // `press` is down, ONE tick, up. The tick is what makes the press visible at
  // all under this engine: the engine arms an action's edge when the key goes
  // down and discards every edge no controller consumed by the end of the frame
  // it was armed in, so a press with no frame inside it never reaches the game.
  const before = (await h.snapshot()).menuIndex;
  await h.press("ArrowDown");
  assertEqual(
    (await h.snapshot()).menuIndex,
    (before + 1) % 2,
    "the title menu's highlight after one `down` (specs/ui.md)",
  );
});

it("holds a key down across the ticks a check drives, and lets it go", async () => {
  await openSite(h, 0);
  const before = (await h.snapshot()).camera.yaw;
  await h.keyDown("ArrowRight");
  await h.advance(20);
  const held = (await h.snapshot()).camera.yaw;
  await h.keyUp("ArrowRight");
  await h.advance(20);
  const released = (await h.snapshot()).camera.yaw;
  assertTrue(held !== before, "the camera yaw moved while `right` was held");
  assertEqual(released, held, "the camera yaw once `right` was released");
});

it("presses an inert key without changing anything the game reports", async () => {
  // `specs/controls.md` binds `UNBOUND_KEY` to no action on any screen, which is
  // what makes it the key a check presses when it wants to establish that a key
  // the game does not know changes nothing.
  const before = JSON.stringify(await h.snapshot());
  await h.press(UNBOUND_KEY);
  const after = await h.snapshot();
  assertEqual(
    JSON.stringify({ ...after, simTime: JSON.parse(before).simTime }),
    before,
    `everything but the clock, across a press of ${UNBOUND_KEY}`,
  );
});

it("makes a click rather than an orbit drag, and picks what it clicks", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);

  // Where the build DRAWS a node, asked through the ENGINE's camera:
  // `specs/controls.md` fixes how a click picks rather than how the yard is
  // drawn, so a check that wants to click a node projects it first.
  const at = await h.project(0, 4, 0);
  assertTrue(at.visible, "the top-flange node (0, 4, 0) is on the stage");
  assertBetween(at.x, 0, STAGE_W, "the projected node's stage x");
  assertBetween(at.y, 0, STAGE_H, "the projected node's stage y");

  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  const aimed = await h.snapshot();
  assertNotNull(aimed.pick.node, "the node a click at that point would take");
  // Half a pixel, because a build is free to keep the pointer at whole logical
  // pixels: `specs/state.md` fixes the units the position is in and not its
  // precision.
  assertClose(
    aimed.pointer.x,
    at.x,
    0.5,
    "the pointer position an update read",
  );
  assertTrue(
    !aimed.pointer.dragging,
    "no press is live, so nothing is dragging",
  );

  await h.click(at.x, at.y);
  const clicked = await h.snapshot();
  assertTrue(
    !clicked.pointer.down,
    "the press the click released (specs/instrumentation.md)",
  );
  assertTrue(
    !clicked.pointer.dragging,
    "a press that never moved is a click, not an orbit drag",
  );
  assertClose(clicked.pointer.pressX, at.x, 0.5, "where the click went down");
  assertNotNull(
    clicked.pendingNode,
    "the pending first node the strut tool's first click holds",
  );
  assertEqual(
    JSON.stringify(clicked.pendingNode),
    JSON.stringify(aimed.pick.node),
    "the node the click took: the one the pick reported",
  );
});

it("holds a press live between its down and its up", async () => {
  await openSite(h, 0);
  await h.pointerDown(400, 300);
  await h.advance(1);
  const down = (await h.snapshot()).pointer;
  assertTrue(down.down, "the press pointerDown started");
  assertEqual(down.pressX, 400, "where the press went down");
  assertEqual(down.pressY, 300, "where the press went down");
  await h.pointerUp();
  await h.advance(1);
  assertTrue(
    !(await h.snapshot()).pointer.down,
    "the press pointerUp released",
  );
});

it("projects through the camera as it stands, and moves nothing", async () => {
  // `project` is the ENGINE's reading here rather than a debug operation, so the
  // one thing this file has to establish is that it follows the camera the game
  // poses and changes nothing while it does.
  await openSite(h, 0);
  const before = await h.project(0, 4, 0);
  const still = JSON.stringify(await h.snapshot());
  await h.debug.setCamera(CAMERA_START_YAW + 90, CAMERA_START_PITCH, 20);
  await h.advance(1);
  const after = await h.project(0, 4, 0);
  assertTrue(
    before.x !== after.x || before.y !== after.y,
    "the projected point followed the camera the check posed",
  );
  const snapshot = await h.snapshot();
  assertEqual(
    JSON.stringify({
      ...snapshot,
      camera: JSON.parse(still).camera,
      simTime: JSON.parse(still).simTime,
    }),
    still,
    "everything but the camera and the clock, across two projections",
  );
});

/* -------------------------------------------------------------------------- */
/* The cues                                                                   */
/* -------------------------------------------------------------------------- */

it("names the cue a run start plays, and drains what it reported", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, SHORT_TAPE);
  await h.cues(); // drain whatever the arrangement made
  await startRun(h);
  const played = await h.cues();
  assertContains(
    played,
    "run-start",
    "the cue a run start plays (specs/ui.md)",
  );
  assertLength(await h.cues(), 0, "the queue a read clears");
});

it("reports every cue it names as one the specification declares", async () => {
  // The engine announces the NAME the game declared, so a name that is not one of
  // Gantry's would be a build calling a cue something else — which is exactly the
  // reading the audio suites rest on, and worth establishing once here.
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, SHORT_TAPE);
  await startRun(h);
  await runTicks(h, 20);
  for (const cue of await h.cues()) {
    assertContains(CUES, cue, "a cue name specs/ui.md declares");
  }
});

it("reports the motor as a loop while a run's axes are turning", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, SHORT_TAPE);
  await startRun(h);
  await runTicks(h, 10);
  const sounding = [...(await h.loopingCues()), ...(await h.cues())];
  assertContains(
    sounding,
    "motor",
    "the loop that runs while an axis's rate is nonzero (specs/ui.md)",
  );
});

/* -------------------------------------------------------------------------- */
/* The evidence                                                               */
/* -------------------------------------------------------------------------- */

it("writes a still where the runner collects the review item's output", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gantry-media-"));
  const was = process.env[MEDIA_DIR_ENV];
  process.env[MEDIA_DIR_ENV] = directory;
  try {
    await openSite(h, 0);
    await emptyYard(h);
    await standMinimalCrane(h);
    await h.advance(1);
    await h.capture("minimal-crane", "the minimal crane on site 1");
    assertTrue(
      existsSync(join(directory, SUITE_DIR, "minimal-crane.png")),
      "the still capture() wrote, under the suite's own path",
    );
  } finally {
    if (was === undefined) delete process.env[MEDIA_DIR_ENV];
    else process.env[MEDIA_DIR_ENV] = was;
    rmSync(directory, { recursive: true, force: true });
  }
});
