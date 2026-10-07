// assets/no-runtime-fetch-outside-dist — the played site fetches nothing from
// outside its own served output.
//
// specs/assets.md, intro: "Production is a one-time step. The tools are
// development tools of this machine; the committed files are the assets, and
// the build bundles them, so `npm ci` and `npm run build` invoke no tool and the
// built site fetches nothing from outside its own `dist/`."
//
// WHAT "OUTSIDE ITS OWN DIST" MEANS HERE. There is no page in this project — the
// engine is stood up in Node — and `validation/host.ts` installs the one
// transport every fetch the build makes goes through. That transport answers a
// RELATIVE URL out of the built tree, exactly as the static server the site is
// served by would; a URL carrying a SCHEME is a URL that names somewhere else,
// and it goes to the network. So a request that reaches outside the built output
// is exactly a request that carries a scheme — a CDN, a font host, a model or
// sample fetched from the web at play time. Every one of them would leave the
// built site broken wherever it is served without a network, which is what the
// requirement exists to prevent.
//
// EVERY REQUEST, AND FROM BEFORE THE FIRST FRAME. The transport is installed
// before a line of the engine or the build runs, so the loads a build makes while
// it is coming up are in the record beside the ones a driven screen makes later.
//
// THE SITE IS PLAYED, NOT JUST OPENED, because a build is free to fetch late: a
// screen's art on first arrival, a cue on first play. So all seven screens are
// shown, an edit is made and taken back, and a run is driven to its verdict
// before the record is read.
//
// AND THE RUN IT IS PLAYED THROUGH IS THE SHORTEST ONE THERE IS. What this point
// needs from a run is the screens it passes and the cues it sounds, not the lift
// it performs, so the site is cleared by the smallest crane that stands and a
// three-step tape: draw the cable in, take the load waiting at the hook's own
// resting point, set it down on the pad it is already standing on. That reaches
// the run screen, the `run-start`, `motor`, `attach`, `placed` and `complete`
// cues, and the results screen, in some forty ticks. Playing site 1's reference
// design and reference tape instead reaches exactly the same screens and cues
// through a hundred-and-thirty-member solve run a thousand times, and makes this
// point turn on a lift that has validators of its own — a build whose reference
// run misses its pad would fail this one for it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN } from "../constants";
import {
  MINIMAL_CRANE,
  addOneLoad,
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

/** The site this plays through; every site is played the same way. */
const SITE = 0;

/** Ticks per crossing while the run plays out, and the cap on it. */
const STRIDE = 30;
const MAX_TICKS = 300;

/** The crate the run lifts. */
const MASS = 40;

/**
 * Where the bare hook comes to rest once the cable is drawn in to `HOIST_MIN`.
 *
 * The minimal crane's pivot is its track origin `(0, 4, 0)`, so a cable of
 * `HOIST_MIN` hangs the bob at `(0, 3, 0)` — which is where the crate waits and
 * where its pad is, so the attach is at a distance of zero and the release is
 * inside every set-down tolerance by the whole of it (specs/rigging.md).
 */
const HOOK = { x: 0, y: HOIST_MIN + 2, z: 0, yaw: 0 } as const;

/** Draw the cable in, take the load, set it down — and the site is cleared. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
  },
  { kind: "action", action: "attach" },
  { kind: "action", action: "release" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fetches nothing from outside the origin its own dist is served on", async () => {
  // Every screen the game has, in the order a player meets them, then a whole
  // run: a build that fetches on arrival at a screen or on a cue's first play
  // has done it by the end of this.
  for (const screen of ["title", "howto", "select"] as const) {
    await h.debug.setScreen(screen);
    await h.advance(1);
  }
  await openSite(h, SITE);
  await h.advance(1);

  await clearAll(h);
  await standMinimalCrane(h);

  // One edit taken back and put again, for the two cues an edit sounds and the
  // art a tool palette might have held a file back for.
  const last = MINIMAL_CRANE.members[MINIMAL_CRANE.members.length - 1]!;
  await h.debug.removeMember(MINIMAL_CRANE.members.length - 1);
  await h.debug.addMember(
    last[0][0],
    last[0][1],
    last[0][2],
    last[1][0],
    last[1][1],
    last[1][2],
    last[2],
  );

  await addOneLoad(h, "crate", MASS, HOOK, HOOK);
  await poseTape(h, TAPE);
  await h.debug.setScreen("program");
  await h.advance(1);
  await h.debug.setScreen("build");
  await startRun(h);

  let ran = 0;
  let phase = "running";
  while (ran < MAX_TICKS) {
    const state = await runTicks(h, STRIDE);
    ran += STRIDE;
    phase = state.run.phase;
    if (phase !== "running") break;
  }
  assertEqual(
    phase,
    "cleared",
    `the three-step tape to clear site ${SITE + 1} within ${MAX_TICKS} ticks, ` +
      "so this point reads a site that was played through to its results " +
      "screen rather than one that was opened",
  );
  await h.advance(1);

  const fetched = h.requests();
  await h.capture("requests", "Every asset the played-through site requested");

  assertGreaterThan(
    fetched.length,
    0,
    "the files the played build fetched, which this point reads off the one " +
      "transport the harness installs",
  );

  const outside = fetched
    // `data:` and `blob:` never leave the built output, so neither is a fetch
    // out of it; everything else carrying a scheme names somewhere else.
    .filter((one) => one.offOrigin && !/^(data|blob):/i.test(one.url))
    .map((one) => one.url);

  assertEqual(
    outside.join(", "),
    "",
    "every request the played build made to name a file inside its own " +
      '`dist/`, since "the built site fetches nothing from outside its own ' +
      '`dist/`" (specs/assets.md) — these named somewhere else',
  );

  console.log(
    `gantry: every asset the played-through site requested —\n  ` +
      fetched.map((one) => `${String(one.status)} ${one.url}`).join("\n  "),
  );
});
