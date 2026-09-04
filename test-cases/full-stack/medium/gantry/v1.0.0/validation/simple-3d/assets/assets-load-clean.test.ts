// assets/assets-load-clean — every asset the built site asks for resolves.
//
// specs/assets.md, "Consuming a model": "the built output carrying every
// produced file under that root is the build's to arrange"; and
// specs/overview.md, "The build interface": "`npm ci` followed by `npm run
// build` produces the complete static site into `dist/` … That directory runs
// correctly when served as-is at the root of any static file server, and equally
// when served from a sub-path, so every asset reference in the build is relative
// rather than root-absolute."
//
// WHAT FAILS THIS POINT. A produced file left out of the built output; a file
// referenced at a path that does not resolve where the site is served from —
// which is what a root-absolute URL does the moment the site is served from a
// sub-path; a name that no longer matches the file after a rename. Each of them
// reaches the page as a request that did not resolve, and each leaves the game
// missing a model or silent on a cue.
//
// THE READING IS EVERY REQUEST'S OWN OUTCOME, AND THIS IS THIS ENGINE'S HALF OF
// THE POINT. There is no page here: this project stands the engine up in this
// process, and `h.assetRequests()` carries every path the build has fetched since
// it was initialized — the ones its own `initialize` made before a check could
// look, as well as the ones a driven screen makes later — with whether the
// output carried the file. A second reading is taken off the engine's own
// `asset:failed` events, so a file that arrived and would not decode is seen
// beside one that never arrived at all.
//
// THERE IS NO BROWSER PROBE TO EXCLUDE. Chromium asks every document it loads for
// a favicon, and an engineless build's version of this point has to set that
// request aside; nothing here asks for anything the build did not.
//
// EVERY SCREEN IS SHOWN AND EVERY PRODUCED FILE IS PUT ON SCREEN OR PLAYED,
// because a build is free to fetch late and a missing file would then only show
// up on the screen, the model, or the cue that wanted it. What that takes is a
// world holding one of everything, not a site played the long way:
//
//   - The seven screens of specs/ui.md, each drawn.
//   - The eight models of specs/assets.md § The models. The minimal crane carries
//     the `ring`, the anchors carry the `mount`s, a counterweight is placed for
//     the `counterweight`, a run puts the `trolley` on the track and the `hook` at
//     the bob, and the yard is posed with one load of each class so the `crate`,
//     the `container` and the `drum` are all drawn.
//   - The cues a route through the game plays: `place` and `delete` from the
//     edits, `run-start` from the start, `motor` from the grip step, `attach` and
//     `placed` from the two action steps, and `complete` from the clear — with the
//     music bed under the title and select screens.
//
// THE ROUTE IS POSED, NOT PLAYED. specs/instrumentation.md's site poses are what
// put one load of each class in the yard, and `setLoadPhase` "sets the load down
// exactly as a successful `release` leaves it", so the two loads this point is not
// lifting are set down rather than carried across the yard one at a time. The
// crate on the hook is attached and released for real, by the tape's own action
// steps, and the clear is the run's own: "a tick that finds no live step and no
// step left to take is the tick the run ends on: cleared if every load is
// `placed`" (specs/program.md). Nothing is posed that the reading then asserts.
//
// WHAT THIS POINT DOES NOT READ. The page's console. A build is free to log
// whatever it likes, and the browser itself logs its own unanswered favicon
// probe there, so a console reading would grade something other than whether the
// assets loaded. This point reads request outcomes and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertVec3Near } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type LoadClass,
  type TapeStepSpec,
} from "../harness";
import { GRIP_MAX_RATE } from "../constants";

/** The site the world is posed on: the smallest envelope of the six. */
const SITE = 0;

/** A node the minimal crane uses, and a ground anchor: dead weight, no moment. */
const BALLAST = { x: 2, y: 0, z: 0 };

/**
 * The cable let out at the start, and where the crate hangs on it.
 *
 * The bob is posed on a cable of exactly the hoist axis's length, so the tick
 * after the pose moves nothing (specs/rigging.md), and one unit of cable leaves
 * the crate's two-unit box a clear unit above the ground: an attached load "whose
 * box dips below the ground … ends the run as `load-struck-ground`"
 * (specs/statics.md), and this point is not about that.
 */
const HOIST_AT = 1;

/**
 * Where the minimal crane's cable hangs from at the start of a run, and where the
 * hook therefore stands with `HOIST_AT` of cable out.
 *
 * The minimal crane's one rail runs from `(0, 4, 0)` to `(4, 4, 0)`, so the track
 * origin — "the end nearer the slew axis" (specs/structure.md) — is `(0, 4, 0)`,
 * and a run starts with `slew` at `0` and `trolley` at the origin
 * (specs/program.md). The pivot is read back before it is relied on, because the
 * crate is posed onto the hook and its pad is fixed before the run begins.
 */
const PIVOT = { x: 0, y: 4, z: 0 };
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_AT, z: PIVOT.z };

/** The three load classes, one of each, and where each stands and belongs. */
const LOADS: readonly {
  cls: LoadClass;
  mass: number;
  x: number;
  y: number;
  z: number;
}[] = [
  { cls: "crate", mass: 40, x: HOOK.x, y: HOOK.y, z: HOOK.z },
  { cls: "container", mass: 90, x: 8, y: 2, z: 0 },
  { cls: "drum", mass: 50, x: 0, y: 2, z: 8 },
];

/**
 * The tape: turn the grip, take the crate, set it down.
 *
 * The grip move is the one axis whose motion "applies no force to anything"
 * (specs/rigging.md), so it turns the drive — and the `motor` loop with it —
 * without disturbing the crate hanging square under the hook. It runs before the
 * `attach`, because `attach` sets the grip to the load's own yaw, so the load's
 * yaw is still `0` when `release` judges it against a target yaw of `0`.
 */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 1, rate: GRIP_MAX_RATE }],
  },
  { kind: "action", action: "attach" },
  { kind: "action", action: "release" },
];

/** Ticks per crossing while the tape runs, and the cap on it. */
const STRIDE = 10;
const MAX_TICKS = 240;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows every screen and draws every produced file with no asset request failing", async () => {
  for (const screen of ["title", "howto", "select"] as const) {
    await h.debug.setScreen(screen);
    await h.advance(1);
  }
  await openSite(h, SITE);
  await h.advance(1);

  // The crane: the ring, the members, and a counterweight — placed, taken away
  // and placed again, so the `delete` cue is played as well as the `place` one.
  await standMinimalCrane(h);
  await h.debug.addCounterweight(BALLAST.x, BALLAST.y, BALLAST.z);
  await h.debug.removeCounterweight(BALLAST.x, BALLAST.y, BALLAST.z);
  await h.debug.addCounterweight(BALLAST.x, BALLAST.y, BALLAST.z);
  await h.advance(1);

  // The yard: one load of each class, each already standing on its own pad, so
  // the two this point is not lifting are set down where they are.
  await emptyYard(h);
  for (const [index, load] of LOADS.entries()) {
    await h.debug.addLoad(load.cls, load.mass, load.x, load.y, load.z, 0);
    await h.debug.setLoadTarget(index, load.x, load.y, load.z, 0);
  }

  await poseTape(h, TAPE);
  await h.debug.setScreen("program");
  await h.advance(1);
  await h.debug.setScreen("build");

  const started = await startRun(h);
  assertGreaterThan(
    started.run.loads.length,
    LOADS.length - 1,
    `the ${LOADS.length} loads the run started with, one of each class, since ` +
      '"the loads a run carries are the ones standing when it starts" ' +
      "(specs/instrumentation.md)",
  );

  assertVec3Near(
    started.run.pivot,
    PIVOT,
    1e-6,
    "the point the cable hangs from at the start of a run on the minimal " +
      "crane, whose one rail gives the track its origin at (0, 4, 0) and whose " +
      "trolley starts there (specs/structure.md, specs/program.md) — the crate " +
      "is posed onto the hook under it",
  );

  // The crate is hung under the hook and the other two are set down, which are
  // preconditions: what follows is the tape's own attach, its own release, and
  // the run's own verdict.
  await h.debug.setAxis("hoist", HOIST_AT);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);
  await h.debug.setBobVelocity(0, 0, 0);
  for (let index = 1; index < LOADS.length; index += 1) {
    await h.debug.setLoadPhase(index, "placed");
  }

  let phase = "running";
  let cause: string | null = null;
  for (let ran = 0; ran < MAX_TICKS; ran += STRIDE) {
    const state = await runTicks(h, STRIDE);
    phase = state.run.phase;
    cause = state.run.cause;
    if (phase !== "running") break;
  }
  assertEqual(
    phase,
    "cleared",
    "the tape to take the crate, set it down and run out with every load " +
      "placed, so this point reads a site that was attached, placed and " +
      `cleared rather than one that was opened${cause === null ? "" : ` (${cause})`}`,
  );
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md), so the seventh screen is " +
      "drawn as well",
  );
  await h.advance(1);

  const asked = h.assetRequests();

  assertGreaterThan(
    asked.length,
    0,
    "the files the played site fetched, which this point reads off every " +
      "request the build made since it was initialized",
  );

  const failed = asked.filter((one) => !one.found).map((one) => one.path);
  assertEqual(
    failed.join(", "),
    "",
    "every request the played site made to resolve, so no produced file is " +
      "missing from the built output or asked for at a path that does not " +
      "resolve (specs/assets.md, specs/overview.md) — these did not",
  );

  assertEqual(
    h.assetFailures.map((one) => `${one.path} (${one.reason})`).join(", "),
    "",
    "no asset the engine loaded for the build to fail on the way in, so every " +
      "produced file the played site asked for arrived and decoded " +
      "(specs/assets.md)",
  );

  console.log(
    `gantry: the play-through with every asset loaded —\n  ` +
      asked
        .map((one) => `${one.found ? "ok " : "404"} ${one.path}`)
        .join("\n  "),
  );

  await h.capture("run", "The play-through with every asset loaded");
});
