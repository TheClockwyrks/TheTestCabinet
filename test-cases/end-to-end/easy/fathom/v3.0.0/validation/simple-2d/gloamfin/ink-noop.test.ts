// gloamfin/ink-noop — ink does nothing to it.
//
// THE CLAIM. `specs/sensing.md` blinds a hunter two ways — "a Lanternjaw or a
// Flarefish is blinded while its center is inside a cloud, or while the segment
// joining its center to the forager's center passes within `INK_RADIUS` of that
// cloud's center" — and then exempts the third kind outright: "an ink cloud has no
// effect on the Gloamfin". `specs/predators/gloamfin.md` says the same of all three
// of its senses: "ink changes nothing about any of the three paths". A blinded
// hunter "drops any fix it holds, takes no new one, and wanders until it is clear
// of the cloud or the cloud expires", so a Gloamfin the ink wrongly touched would
// report `"wander"` and stop closing.
//
// SO THE POINT ASKS BOTH SHAPES, because a build that got one wrong can pass the
// other. First a cloud laid ON the forager, which puts it squarely on the segment
// between the two while the Gloamfin is still sixteen tiles out and never inside
// it; then a cloud laid on the tile the Gloamfin is standing on, which is the
// containment half. Each is watched for the whole `INK_LIFE` (`3 s`) the cloud
// stands, because "does nothing to it" is a claim about a hunter that keeps coming
// and a single instant cannot tell that from one that recoils on the next step.
//
// SIXTEEN TILES, AND THAT NUMBER IS DOING WORK. Close hearing reaches
// `GLOAMFIN_HEAR` (`64`) — two tiles — and it "works... through ink", so a Gloamfin
// allowed to close inside it would know where the forager was for a reason that has
// nothing to do with the fix the ink was supposed to break, and a build whose ink
// DID wrongly break the fix would read as chasing again and pass for the opposite
// reason. Sixteen tiles is `512` logical units; a conforming Gloamfin covers `402`
// of them in the cloud's whole life, so it is still over three tiles clear when the
// window closes, and the chase that is read can only be the one the ink failed to
// break.
//
// THE SECOND CLOUD IS PUT UNDER THE HUNTER WITH DOCUMENTED OPERATIONS ALONE: the
// forager is moved to the far tile, releases its cloud there, and is moved back
// (`specs/instrumentation.md`'s `setForagerTile`), and the Gloamfin is then posed
// onto that tile chasing. Nothing here reaches past the surface the specification
// gives.
//
// WHAT THIS DOES NOT DECIDE. How fast the chase closes (`gloamfin/chase-cap`),
// what ink does to the hunters it DOES blind (`lanternjaw/*`, `flarefish/*`), or
// what a cloud costs to release (`ink/*`).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNull,
} from "../assert";
import { GLOAMFIN_HEAR, INK_LIFE, TICK_HZ, TILE } from "../../src/constants";
import { poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import type { FathomSnapshot } from "../surface";
import {
  clearUnderfoot,
  denAll,
  graded,
  parkForager,
  requirePred,
  requirePredatorMotion,
  sceneGuard,
  sceneHeld,
  unmetPrecondition,
} from "../scene";
import { apart, gloamfinOf, placePredator, sweep } from "./pings";

/**
 * The fixture: the forager rests on `I` and releases its cloud there, and the
 * Gloamfin starts sixteen tiles along the same corridor on `P`.
 */
const STANDOFF = ["..I" + ".".repeat(15) + "P"];

/** The key `specs/movement.md` binds the `b` action, which releases ink, to. */
const INK_KEY = "ShiftLeft";

/**
 * How long each half of the scenario is watched for, in ticks.
 *
 * `INK_LIFE` (`3 s`), which is the cloud's whole life — the window the
 * specification's own exemption covers, and the window a blinded hunter would
 * "wander until... the cloud expires" for.
 */
const CLOUD_TICKS = INK_LIFE * TICK_HZ;

/** How long the scenario waits for the first cloud to expire before the second. */
const EXPIRY_BUDGET = TICK_HZ;

/**
 * How much ground the Gloamfin must take out of the gap over a cloud's life, in
 * logical units.
 *
 * Two tiles. A conforming chase covers over twelve tiles in that window, so this is
 * a sixth of it: enough to tell a hunter that kept coming from one that stopped, and
 * deliberately far short of a speed reading, which is `gloamfin/chase-cap`'s.
 */
const CLOSED_MIN = 2 * TILE;

/** What one watched cloud-life came to. */
interface Crossing {
  /** Every state the Gloamfin reported while a cloud stood. */
  states: Set<string>;
  /** The gap between the two centers at the first and last sample. */
  opened: number;
  ended: number;
  /** The closest the two came at any sample. */
  closest: number;
  /** Samples at which the Gloamfin's own center lay inside a cloud. */
  inside: number;
  /** Samples taken while a cloud stood at all. */
  samples: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Watch one cloud out, reading the Gloamfin at every sample. */
async function watchCloud(index: number): Promise<Crossing> {
  const opening = h.snapshot();
  const crossing: Crossing = {
    states: new Set<string>(),
    opened: apart(opening.forager, gloamfinOf(opening, index)),
    ended: apart(opening.forager, gloamfinOf(opening, index)),
    closest: apart(opening.forager, gloamfinOf(opening, index)),
    inside: 0,
    samples: 0,
  };
  await sweep(h, CLOUD_TICKS, (snap: FathomSnapshot) => {
    if (snap.inkClouds.length === 0) return;
    const hunter = gloamfinOf(snap, index);
    const gap = apart(snap.forager, hunter);
    crossing.states.add(hunter.state);
    crossing.ended = gap;
    crossing.closest = Math.min(crossing.closest, gap);
    crossing.samples += 1;
    if (
      snap.inkClouds.some(
        (cloud) =>
          Math.hypot(cloud.x - hunter.x, cloud.y - hunter.y) <= cloud.radius,
      )
    ) {
      crossing.inside += 1;
    }
  });
  return crossing;
}

/** Release a cloud where the forager stands, or stand the check down. */
async function releaseInk(what: string): Promise<void> {
  await h.debug.setInkCooldown(0);
  await h.tap(INK_KEY);
  if (h.snapshot().inkClouds.length === 0) {
    unmetPrecondition(
      `no ink cloud stood after the b action was pressed with the cooldown at 0, ` +
        `so there was no ${what} for this point to watch the Gloamfin through — ` +
        `specs/sensing.md releases a cloud when ink's cooldown is 0 and ` +
        `specs/movement.md binds that action to ${INK_KEY}, and whether ink is ` +
        `released at all is the ink checks' verdict, not this one's`,
    );
  }
}

it("Ink does nothing to it", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    const board = await poseMaze(h, STANDOFF);
    const index = requirePred(board.snap, "gloamfin");
    const quiet = await denAll(h, ["gloamfin"]);
    // The forager first, and parked: a posed chase fixes on "the forager's current
    // tile" (specs/instrumentation.md), and that tile is where the first cloud goes.
    await parkForager(h, board.mark("I"));
    await clearUnderfoot(h);
    await placePredator(h, index, board.mark("P"), {
      dir: "left",
      state: "chase",
    });
    const guard = await sceneGuard(h, quiet);

    const watched = await captureReplay(h, "noop", async () => {
      // ---- The cloud on the line between them --------------------------------
      await releaseInk("cloud on the line between the two");
      const openingOnLine = h.snapshot();
      const onLine = await watchCloud(index);
      const closedOnLine = h.snapshot();

      // ---- And the cloud the hunter is standing in ---------------------------
      await h.until((snap) => snap.inkClouds.length === 0, {
        maxFrames: EXPIRY_BUDGET,
        poll: 4,
      });
      // The forager lays the second cloud on the far tile and comes back, which is
      // the only way this surface can put one under a hunter.
      await parkForager(h, board.mark("P"));
      await releaseInk("cloud under the hunter itself");
      await parkForager(h, board.mark("I"));
      await placePredator(h, index, board.mark("P"), {
        dir: "left",
        state: "chase",
      });
      const openingInside = h.snapshot();
      const inside = await watchCloud(index);
      const closedInside = h.snapshot();

      return {
        onLine,
        openingOnLine,
        closedOnLine,
        inside,
        openingInside,
        closedInside,
      };
    });

    assertNull(sceneHeld(h.snapshot(), guard), "the scenario held to the end");

    for (const [what, crossing, opening, closed] of [
      [
        "with the cloud on the line between it and the forager",
        watched.onLine,
        watched.openingOnLine,
        watched.closedOnLine,
      ],
      [
        "standing inside the cloud",
        watched.inside,
        watched.openingInside,
        watched.closedInside,
      ],
    ] as const) {
      requirePredatorMotion(
        opening,
        closed,
        "gloamfin",
        `chase on through the ink cloud this scenario laid ${what}`,
      );
      assertGreaterThan(
        crossing.samples,
        0,
        `samples taken while a cloud stood, ${what} — INK_LIFE (${INK_LIFE} s) is ` +
          `how long specs/sensing.md stands one for`,
      );
      assertGreaterThan(
        crossing.closest,
        GLOAMFIN_HEAR,
        `the closest the two centers came ${what}, against the GLOAMFIN_HEAR ` +
          `(${GLOAMFIN_HEAR}) close hearing reaches — inside it the Gloamfin would ` +
          `know where the forager was for a reason that has nothing to do with ink, ` +
          `and this scenario is posed so that never happens`,
      );
      assertEqual(
        [...crossing.states].join(","),
        "chase",
        `the states the Gloamfin reported across the cloud's whole life ${what} — ` +
          `specs/sensing.md exempts the Gloamfin from ink outright, and a blinded ` +
          `hunter would drop its fix and report "wander"`,
      );
      assertGreaterThanOrEqual(
        crossing.opened - crossing.ended,
        CLOSED_MIN,
        `logical units the Gloamfin took out of the gap over the cloud's whole ` +
          `life ${what}, from ${crossing.opened.toFixed(0)} to ` +
          `${crossing.ended.toFixed(0)} — specs/predators.md has a hunter holding a ` +
          `fix pursue the fixed tile every step of the way`,
      );
    }

    assertGreaterThan(
      watched.inside.inside,
      0,
      "samples at which the Gloamfin's own center lay inside the cloud — the " +
        "second half of this point is specs/sensing.md's containment case, and a " +
        "hunter that never entered the cloud cannot answer it",
    );
  });
});
