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
// So the served build is driven through the three phases `specs/campaign.md` has
// — a build phase, a wave, and the finale — with something of every kind on the
// yard: a component firing, a rock stamped, six of the seven Load types walking,
// one of them burning and dying inside the wave, and the Overload Dynamo. The
// death is POSED rather than waited for: one Load is stood up on a single point
// of health under a burn, so a build that loads its burn art or its death burst
// on the first death reaches for them here rather than on whether the standing
// component happened to finish something off in time. Anything the page asked the
// origin for and did not get
// is a console error the browser raises on its own, and the harness has been
// listening since before the page loaded, so a file the build never bundled shows
// up here whatever the build does about it afterwards.
//
// The page is given a real gesture first, because a browser will not open an
// audio context without one and the twelve produced `.wav` files are assets like
// any other.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureReplay,
  clearHand,
  createHarness,
  holdWaveOpen,
  openYard,
  parkUnit,
  pressAction,
  releaseUnit,
  standComponent,
  type Harness,
} from "../harness";
import { LOAD_TYPES, structureCenter, tileCenter } from "../constants";

/** Clear ground, away from the map's waypoint platforms and its chain. */
const BURNING = { col: 21, row: 18 };

/** The burn the posed Load dies under: enough to take a point of health at once. */
const BURN_DPS = 500;
const BURN_SECONDS = 3;

/** What a browser says when the origin had nothing at the path it was asked for. */
const MISSING =
  /failed to load|net::|404|not found|err_|decodeaudiodata|no such file/i;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("asks the site for nothing it does not carry, across all three phases", async () => {
  await openYard(h, { wave: 12, charge: 500 });

  await captureReplay(h, "run", async () => {
    // A build phase: the press, a placed rock, and a standing component.
    await pressAction(h, "stamp");
    await h.debug.pointerMove(
      structureCenter(20, 20).x,
      structureCenter(20, 20).y,
    );
    await h.advanceSeconds(0.5);
    await h.debug.placeRock(20, 20);
    await clearHand(h);
    await standComponent(h, "capacitor", 4, 10, 10);
    await h.advanceSeconds(1);

    // A wave: every Load type the roster carries, walking and being shot at, and
    // one of them burning to death on clear ground away from the chain.
    await holdWaveOpen(h);
    for (const type of LOAD_TYPES) await releaseUnit(h, type);
    await parkUnit(h, "mote", tileCenter(BURNING.col, BURNING.row), {
      hp: 1,
      burn: { dps: BURN_DPS, seconds: BURN_SECONDS },
    });
    await h.advanceSeconds(4);

    // The finale: the Overload Dynamo, which no wave carries.
    await h.debug.clearUnits();
    await releaseUnit(h, "overload");
    await h.advanceSeconds(2);
  });

  assertDeepEqual(
    h.pageErrors.filter((line) => MISSING.test(line)),
    [],
    "what the page could not load while a run was driven through a build " +
      "phase, a wave, and the finale",
  );
});
