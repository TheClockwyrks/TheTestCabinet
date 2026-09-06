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
// file the repository does not carry at the path the build asked for. THE HOST
// IMPOSES NO FAILURE OF ITS OWN, and this point reads every failure there is: the
// harness installs the `AudioContext` the cue bus decodes through and the tolerant
// decoder behind it, so the twelve `.wav` cues arrive like every other produced
// file, and a `.wav` that turns out to be unreadable comes back as silence and is
// judged by `audio/cue-files-present` rather than counted here. Every failure this
// reads is therefore a produced file that did not arrive.
//
// The drive is the three phases `specs/campaign.md` has — a build phase, a wave,
// and the finale — with something of every kind on the yard: a component firing, a
// rock stamped, six of the seven Load types walking, and the Overload Dynamo. A
// build that loads a file lazily is what it is for, and it is the replay this
// point keeps as evidence.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  holdWaveClear,
  openYard,
  pressAction,
  putAwayHeld,
  releaseUnit,
  standComponent,
} from "../harness";
import { ASSET_ROOT, LOAD_TYPES, structureCenter } from "../constants";

/** The repository this project sits in, which is where `assets/` is rooted. */
const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));

/** A path that leaves the page's own base path (specs/assets.md). */
const ESCAPES = /^\/|^[a-z][a-z0-9+.-]*:/i;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
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
    await h.advanceSeconds(0.5);
    h.debug.placeRock(20, 20);
    putAwayHeld(h);
    standComponent(h, "capacitor", 4, 10, 10);
    await h.advanceSeconds(1);

    // A wave: every Load type the roster carries, walking and being shot at.
    holdWaveClear(h);
    for (const type of LOAD_TYPES) releaseUnit(h, type);
    await h.advanceSeconds(4);

    // The finale: the Overload Dynamo, which no wave carries.
    h.debug.clearUnits();
    releaseUnit(h, "overload");
    await h.advanceSeconds(2);
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
    h.assetFailures.map((failure) => `${failure.path} — ${failure.reason}`),
    [],
    "what the build asked the site for and did not get",
  );
});
