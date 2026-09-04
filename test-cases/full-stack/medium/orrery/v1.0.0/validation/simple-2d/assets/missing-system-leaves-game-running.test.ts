// assets/missing-system-leaves-game-running — a particle system that will not
// load leaves the game running.
//
// THE RULE, from the close of `specs/assets.md`'s "Where the files land, and how
// they are loaded": "A load that fails leaves the game running. The game still
// initializes, still ticks, still takes keyboard and pointer input, and still
// draws a legible field, tray, and tape panel when a sprite, a sheet frame, a
// system, or a sound is unavailable, so a missing file costs the game its polish
// rather than its playability." This point is the SYSTEM of those four, and what
// a system costs the game when it is gone is read where the system would have
// played rather than on a panel: the run itself.
//
// WHICH SYSTEM, AND WHERE IT WOULD HAVE FIRED. The delivery effect,
// `assets/particles/deliver.json`, whose row in "The particle effects" fires it
// at "each set that consumed at least one accepted constellation at this
// boundary, on its anchor hex". So the run below is one that genuinely fires it:
// a set placed on `ORIGIN` for `ONE_DELIVERY`'s one product — a lone `sol` on
// `(0, 0)` — with one unheld, unbonded `sol` spawned on that hex, which is
// exactly the placed pattern `specs/sigils.md` accepts. The boundary consumes it,
// the tally rises, and with `target` `1` that same boundary completes the run.
//
// THE THREE CLAUSES BEFORE THE RUN. INITIALIZES: the surface the build installed
// can be driven at all, and a reset and one frame leave the title screen the game
// opens on. TICKS: a live run driven one whole cycle of game time has crossed one
// boundary. TAKES KEYBOARD INPUT: `speed-up`, pressed on a live run whose step was
// posed at `0`, moves the step — "The speed actions of `specs/controls.md` move
// the setting one step and stop at `0` and at `3`" (`specs/simulation.md`).
// TAKES POINTER INPUT: two tray drags place two parts,
// which is the gesture `specs/editor.md` places one with.
//
// WHAT THE ITEM ASKS OF THE RUN. That it "still runs, faults and completes" — the
// three things a run does. It RUNS: the run stands `running` on a live field
// before any of it happens. It COMPLETES: the delivering boundary leaves
// `sim.status` `complete`, with the tally at the target and the accepted
// constellation consumed whole. It FAULTS: a second run, over a `piston` placed
// at `ARM_MAX_LEN` (`3`) whose tape's one cell is `extend`, raises the fault
// `specs/simulation.md` names for it — "`extend` on a piston already at
// `ARM_MAX_LEN`" is `overextended` — and names the piston. Neither outcome is the
// effect's to decide, and with the effect's file gone both still arrive.
//
// A FILE THE BUILD NEVER REQUESTS CANNOT BE WITHHELD. `specs/assets.md` requires
// the systems produced and bundled, and a bundler is free to inline a small
// produced `system.json` into the bundle as parsed data rather than fetching it;
// that is still the committed file and is still conformant, and such a build
// makes no request to refuse. What this check then observes is a game that never
// missed anything, which is the honest outcome rather than a gap. So nothing here
// asserts that the load failed; what is asserted is what the sentence asks for
// either way.
//
// THE WORLD IS POSED, NOT SEARCHED. Each run opens on a posed challenge document
// with exactly one part on the field — the set in the first, the piston in the
// second — so nothing else can deliver, and nothing else can fault.
//
// THE EVIDENCE is the frames of the delivering run itself.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNull,
} from "../assert";
import { ARM_MAX_LEN, PARTICLE_PATHS } from "../constants";
import { armPart, setPart, solution } from "../formats";
import { BARE, ONE_DELIVERY, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  openRun,
  partIds,
  spawnMote,
  tallyOf,
  type Harness,
} from "../harness";
import { playThrough, withoutFile } from "./degraded";
import { assetFile } from "./files";

/** The particle system this check withholds: the one a delivery fires. */
const WITHHELD = assetFile(PARTICLE_PATHS.deliver);

/** Which of the challenge's products the placed set receives. */
const PRODUCT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ withoutAssets: withoutFile(WITHHELD) });
});

afterEach(async () => {
  await h.dispose();
});

it("delivers, completes and faults with the delivery system unavailable", async () => {
  assertNull(
    h.surfaceFault,
    `the game still initializes with ${WITHHELD} unavailable, so its debug surface can be driven`,
  );

  const played = await playThrough(h);
  assertEqual(
    played.screen,
    "title",
    "the game still initializes: a reset and one frame leave the title screen it opens on",
  );
  assertEqual(
    played.speed.before,
    0,
    "the run's speed step is posed at 0, which is what the presses move it from",
  );
  assertGreaterThan(
    played.speed.after,
    played.speed.before,
    "the game still takes keyboard input: speed-up moved the run's speed step",
  );
  assertEqual(
    played.parts.before,
    0,
    "the machine is empty before the drags, so what the drags place is all there is",
  );
  assertEqual(
    played.parts.after,
    2,
    "the game still takes pointer input: two tray drags placed the arm and the rise",
  );
  assertEqual(
    played.run.status,
    "running",
    "the game still ticks: the cycle the run was driven crossed its boundary without stopping",
  );
  assertEqual(
    played.run.cycle,
    1,
    "one whole cycle of game time crossed one boundary, so the counter reads 1",
  );

  await openRun(h, {
    challenge: ONE_DELIVERY,
    machine: solution([setPart(PRODUCT, ORIGIN.q, ORIGIN.r)]),
  });
  await spawnMote(h, ORIGIN, "sol");

  const opened = await h.snapshot();
  assertEqual(
    opened.sim?.status,
    "running",
    "the game still runs: the posed challenge stands live before the boundary",
  );
  assertEqual(
    opened.challenge?.target,
    1,
    "ONE_DELIVERY's target is 1, so the delivery below is also the completion",
  );
  assertEqual(
    tallyOf(opened, PRODUCT),
    0,
    "nothing has been delivered before the run advances",
  );

  await captureReplay(h, "degraded", () => advanceCycles(h, 1));

  const delivered = await h.snapshot();
  assertEqual(
    tallyOf(delivered, PRODUCT),
    1,
    "the set consumed the accepted constellation, which is the boundary the delivery system fires at",
  );
  assertLength(
    delivered.sim?.motes ?? [],
    0,
    "an accepted constellation is consumed whole, so the delivery really happened",
  );
  assertEqual(
    delivered.sim?.status,
    "complete",
    "the game still completes: the boundary found the one set's tally at the target",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MAX_LEN, ["extend"]),
    ]),
  });
  const piston = (await partIds(h))[0] ?? -1;
  await advanceCycles(h, 1);

  const faulted = await h.snapshot();
  assertEqual(
    faulted.sim?.status,
    "faulted",
    "the game still faults: extend on a piston already at ARM_MAX_LEN cannot be performed",
  );
  assertEqual(
    faulted.sim?.fault?.kind,
    "overextended",
    "extend on a piston already at ARM_MAX_LEN raises overextended",
  );
  assertDeepEqual(
    faulted.sim?.fault?.parts,
    [piston],
    "a fetch fault names the faulting part",
  );
  assertGreaterThan(
    piston,
    -1,
    "the machine placed the one piston, so the fault above names a part this check put there",
  );
});
