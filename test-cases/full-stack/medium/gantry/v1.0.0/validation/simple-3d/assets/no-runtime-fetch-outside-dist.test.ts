// assets/no-runtime-fetch-outside-dist — the played site fetches nothing from
// outside its own served output.
//
// specs/assets.md, intro: "Production is a one-time step. The tools are
// development tools of this machine; the committed files are the assets, and
// the build bundles them, so `npm ci` and `npm run build` invoke no tool and the
// built site fetches nothing from outside its own `dist/`."
//
// WHAT "OUTSIDE ITS OWN DIST" MEANS HERE, AND THIS IS THIS ENGINE'S HALF OF THE
// POINT. There is no page and no origin: this project stands the engine up in
// this process, and every path the build asks for goes through the harness's own
// fetch, which serves the workspace's own files and nothing else. So a request
// that reaches outside the built output is exactly a request the build wrote as
// an ABSOLUTE URL — a CDN, a font host, a model or sample fetched from the web at
// play time — because a relative path cannot leave the output it is resolved
// against. Every such request would leave the built site broken wherever it is
// served without a network, which is what the requirement exists to prevent.
//
// A ROOT-ABSOLUTE PATH IS OUTSIDE IT TOO. `specs/overview.md` requires "every
// asset reference in the build is relative rather than root-absolute", because a
// leading `/` leaves the sub-path the site is served from and reaches the host's
// root instead. So a path beginning `/` fails this reading as surely as a `https:`
// URL does.
//
// EVERY REQUEST, NOT EVERY REQUEST A LISTENER CAUGHT. `h.assetRequests()` carries
// every path this build has fetched since it was initialized, including the ones
// its own `initialize` made before a check could look.
//
// AND THE OFF-ORIGIN ONES ARE THE POINT OF IT. The harness's transport answers a
// page-relative URL out of the workspace and hands anything carrying a scheme to
// the platform, and it records both, so the CDN fetch this point exists to catch
// arrives in the reading with `offOrigin` set rather than being quietly absent
// from it. That is what makes the reading below a judgement rather than a
// formality: were the off-origin requests dropped before a check could see them,
// this point would pass every build, including the one that fetches every model
// it draws from the web.
//
// `data:` AND `blob:` ARE THE ONE KIND OF SCHEME THAT PASSES. Both carry their
// own bytes and reach no host at all, so neither leaves the built output and
// neither breaks a site served without a network — which is the whole of what
// this requirement protects.
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

  const fetched = h.assetRequests();

  await h.capture("requests", "Every asset the played-through site requested");

  assertGreaterThan(
    fetched.length,
    0,
    "the files the played site fetched, which this point reads off every " +
      "request the build made since it was initialized",
  );

  const outside = fetched
    .filter(
      (one) =>
        // A scheme of any kind leaves the output, and `offOrigin` is the
        // transport's own reading of exactly that — a request it did not answer
        // off the workspace but handed to the platform — save for `data:` and
        // `blob:`, which name no host. A leading `/` leaves it too, by reaching
        // the host's root rather than the path the site is served from.
        (one.offOrigin && !/^(data|blob):/i.test(one.path)) ||
        one.path.startsWith("/"),
    )
    .map((one) => one.path);

  assertEqual(
    outside.join(", "),
    "",
    "every request the played site made to be a path relative to the output " +
      'it is served from, since "the built site fetches nothing from outside ' +
      'its own `dist/`" (specs/assets.md) and every asset reference is ' +
      "relative rather than root-absolute (specs/overview.md) — these were not",
  );

  console.log(
    `gantry: every asset the played-through site requested —\n  ` +
      fetched
        // An off-origin request has no status of this transport's to report: it
        // went to the platform, so it is neither the `ok` of a file the output
        // answered with nor the `404` of one it did not carry.
        .map(
          (one) =>
            `${one.offOrigin ? "off" : one.found ? "ok " : "404"} ${one.path}`,
        )
        .join("\n  "),
  );
});
