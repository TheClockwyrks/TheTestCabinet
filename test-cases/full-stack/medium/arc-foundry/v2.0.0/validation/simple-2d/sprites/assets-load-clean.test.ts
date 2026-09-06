// sprites/assets-load-clean — nothing the build asks the site for is missing.
//
// `specs/assets.md` fixes where every produced file lands and how the build
// reaches it: "the built site is served from any base path... so every URL the
// build requests resolves against the page rather than against the origin root:
// no request carries a leading `/`", and "the built site is self-contained and
// carries every file it draws and plays". `specs/overview.md` requires the same
// of the build interface: `dist/` "runs correctly served as-is from any base
// path".
//
// WHAT IS READ, AND WHY IT IS A CENSUS. Every asset request the build makes is
// announced by the engine with the path the build asked for, whether the request
// arrived or not, and this harness has been listening since before the game's own
// code ran. The two records together are therefore a COMPLETE list of everything
// the build reached for. That is a stronger reading than watching a served page: a
// file the build asks for on some path a drive never reaches cannot hide.
//
// Each path the build asked for is then held to the two things the specification
// fixes about it. It has to be relative — a leading `/`, a `..` segment, or a URL
// scheme is a request that leaves the page's own base path, and the engine refuses
// exactly those. And the repository has to carry the file at that path, since a
// path the build asks for and did not produce is a hole in the built site
// wherever it is served from.
//
// AND WHAT THE BUILD ASKED FOR HAS TO HAVE ARRIVED. The harness serves the
// committed `assets/` tree to the engine's loader, so a request that failed is a
// file the repository does not carry at the path the build asked for. The one
// exception is the host's, not the build's: decoding audio needs a Web Audio
// context and a node process has none, so the twelve `.wav` cues fetch cleanly and
// fail at the decode with a reason naming the missing context. A failure of any
// other shape is a produced file that did not arrive.
//
// The drive is the three phases `specs/campaign.md` has — a build phase, a wave,
// and the finale — with something of every kind on the yard: a component firing, a
// rock stamped, six of the seven Load types walking, one of them burning and dying
// inside the wave, and the Overload Dynamo. A build that loads a file lazily is
// what it is for, and it is the replay this point keeps as evidence.
//
// THE DEATH IS POSED RATHER THAN WAITED FOR. What makes a build reach for its
// burn art and its death burst is a Load burning and dying, and waiting for the
// standing component to finish one off makes whether those files are asked for a
// question of how long the wave window happens to run. One Load is stood up on a
// single point of health under a burn instead, so the death lands inside the
// window on every build and the window is only as long as the phase needs.
//
// THE CLOCK IS THE CHECK'S. What the drive spends its frames on is reaching the
// three phases rather than reading anything positional, and
// `specs/instrumentation.md` guarantees that "an interval of simulation time
// reaches the same state however it was divided into frames and whatever frame
// rate produced it", so it runs at `DRIVE_HZ`. A shot still steps well inside the
// `2 * PROJECTILE_HIT_R` window it has to be caught in, so the impacts that make
// a build reach for its impact art still land.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureReplay,
  clearHand,
  createHarness,
  type Harness,
  holdWave,
  openYard,
  parkUnit,
  pressAction,
  releaseUnit,
  standComponent,
} from "../harness";
import {
  ASSET_ROOT,
  LOAD_TYPES,
  structureCenter,
  tileCenter,
} from "../constants";

/** The repository this project sits in, which is where `assets/` is rooted. */
const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));

/** A path that leaves the page's own base path (specs/assets.md). */
const ESCAPES = /^\/|^[a-z][a-z0-9+.-]*:/i;

/** The one failure this host imposes on every build: no Web Audio to decode into. */
const NO_AUDIO_CONTEXT = /this host has no AudioContext/;

/** The rate the three phases are driven at. */
const DRIVE_HZ = 60;

/** Clear ground, away from the map's waypoint platforms and its chain. */
const BURNING = { col: 21, row: 18 };

/** The burn the posed Load dies under: enough to take a point of health at once. */
const BURN_DPS = 500;
const BURN_SECONDS = 3;

/** Seconds spent in each of the three phases. */
const BUILD_SECONDS = 0.5;
const STANDING_SECONDS = 0.5;
const WAVE_SECONDS = 1.5;
const FINALE_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: DRIVE_HZ });
});

afterEach(() => {
  h.dispose();
});

/** Why a requested path is not one the built site carries, or `null`. */
function fault(path: string): string | null {
  if (path === "") return "an empty path";
  if (ESCAPES.test(path)) return `${path} — not relative to the page`;
  if (path.split("/").includes("..")) return `${path} — leaves the asset root`;
  const file = join(REPOSITORY, ASSET_ROOT, path);
  return existsSync(file) ? null : `${path} — no such file in the repository`;
}

it("asks the site for nothing it does not carry, across all three phases", async () => {
  openYard(h, { wave: 12, charge: 500 });

  await captureReplay(h, "run", async () => {
    // A build phase: the press, a placed rock, and a standing component.
    await pressAction(h, "stamp");
    const rock = structureCenter(20, 20);
    h.pointerMove(rock.x, rock.y);
    await h.advanceSeconds(BUILD_SECONDS);
    h.debug.placeRock(20, 20);
    clearHand(h);
    standComponent(h, "capacitor", 4, 10, 10);
    await h.advanceSeconds(STANDING_SECONDS);

    // A wave: every Load type the roster carries, walking and being shot at, and
    // one of them burning to death on clear ground away from the chain.
    holdWave(h);
    for (const type of LOAD_TYPES) releaseUnit(h, type);
    parkUnit(h, "mote", tileCenter(BURNING.col, BURNING.row), {
      hp: 1,
      burn: { dps: BURN_DPS, seconds: BURN_SECONDS },
    });
    await h.advanceSeconds(WAVE_SECONDS);

    // The finale: the Overload Dynamo, which no wave carries.
    h.debug.clearUnits();
    releaseUnit(h, "overload");
    await h.advanceSeconds(FINALE_SECONDS);
  });

  const asked = [
    ...new Set([...h.assetLoads, ...h.assetFailures.map((f) => f.path)]),
  ];
  assertDeepEqual(
    asked.flatMap((path) => {
      const bad = fault(path);
      return bad === null ? [] : [bad];
    }),
    [],
    "what the build asked for while a run was driven through a build phase, " +
      "a wave, and the finale that the repository does not carry under " +
      `${ASSET_ROOT} at the path asked for`,
  );

  assertDeepEqual(
    h.assetFailures
      .filter((failure) => !NO_AUDIO_CONTEXT.test(failure.reason))
      .map((failure) => `${failure.path} — ${failure.reason}`),
    [],
    "what the build asked the site for and did not get, leaving out the " +
      "twelve cues this host cannot decode",
  );
});
