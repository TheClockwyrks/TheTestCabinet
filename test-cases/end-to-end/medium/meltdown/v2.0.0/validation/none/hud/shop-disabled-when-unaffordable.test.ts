// hud/shop-disabled-when-unaffordable — an entry whose cost is above the money is
// drawn plainly apart from an affordable one.
//
// `specs/hud.md`, The shop: "An entry whose build cost is above the current money
// is drawn disabled, plainly apart from an affordable entry."
//
// THE MONEY IS POSED ON THE BOUNDARY THE RULE STATES, which is what makes this a
// reading of the rule rather than of a gulf. The Lance costs `150`
// (`specs/towers.md`), so at `149` its cost is above the money and the entry is
// disabled, and at `150` it is not above the money — "above", not "at or above" —
// and the entry is affordable. One money of difference is the whole of the
// arrangement, so a build that disables an entry it can exactly afford fails here
// and a build that draws the two states alike fails here.
//
// WHAT IS COMPARED, AND WHY IT IS COLOUR-FREE. `specs/overview.md` fixes no
// palette, so nothing here says what disabled looks like: the Lance's own box —
// the rectangle the panel reports for it (`specs/instrumentation.md`) — is
// photographed at each of the two money levels and the two pictures are compared.
// A build may grey the name, dim the cost, cross the box out or stamp it; every
// one of those moves pixels, and a build that draws the two states identically
// moves none.
//
// THE ARC IS THE CONTROL. It costs `15`, so it is affordable at both money levels
// and its box must not move: without it, a panel that redrew its whole strip
// differently at `150` than at `149` — a money readout inside every entry, say —
// would pass on a change that had nothing to do with affordability.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { TOWER_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  shopControl,
  startRun,
  type Harness,
} from "../harness";
import { differing, pixelsOver } from "./panel";

/** The entry under test, and the one that stays affordable throughout. */
const DEAR = "lance" as const;
const CHEAP = "arc" as const;

/** The money one short of the Lance's cost, where its entry is unaffordable. */
const SHORT = TOWER_DEFS[DEAR].cost - 1;

/** The money exactly equal to it, where its entry is affordable. */
const EXACTLY = TOWER_DEFS[DEAR].cost;

/**
 * The RGB distance, out of the 441 a full swing across the cube is, at which two
 * colours count as plainly apart.
 *
 * `specs/overview.md`'s legibility table asks that a disabled entry read apart
 * from an affordable one at a glance and fixes no colours, so this is the point's
 * own figure: `60` is roughly an eighth of the cube's diagonal, past any
 * anti-aliasing wobble and well under the swing between a lit and a dimmed run of
 * text.
 */
const PLAINLY = 60;

/**
 * How many of the entry's pixels must move that far: forty.
 *
 * Forty pixels is about the ink of one small glyph, so it is less than any
 * recolouring of an entry's name or its cost can amount to, and it is far more
 * than the zero a static scene moves on its own — which is why the affordable
 * entry is held to a quarter of it.
 */
const MOVED = 40;

/** What the control entry is allowed to move: essentially nothing. */
const STILL = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the Lance's entry apart at 149 money from the same entry at 150", async () => {
  await startRun(h);

  await h.debug.setMoney(SHORT);
  // A frame, so what the canvas holds is the panel drawn for this money: a pose
  // moves the state and the picture is what the next frame leaves behind.
  await h.advance(1);
  const short = await h.snapshot();
  const dearShort = await pixelsOver(h, shopControl(short, DEAR));
  const cheapShort = await pixelsOver(h, shopControl(short, CHEAP));
  await captureStill(h, "disabled");

  await h.debug.setMoney(EXACTLY);
  await h.advance(1);
  const exactly = await h.snapshot();
  const dearExactly = await pixelsOver(h, shopControl(exactly, DEAR));
  const cheapExactly = await pixelsOver(h, shopControl(exactly, CHEAP));

  assertEqual(
    short.money,
    SHORT,
    "precondition: the money one short of the Lance's cost",
  );
  assertEqual(
    exactly.money,
    EXACTLY,
    "precondition: the money exactly the Lance's cost",
  );

  assertGreaterThanOrEqual(
    differing(dearShort, dearExactly, PLAINLY),
    MOVED,
    `the Lance's entry to read plainly apart at ${SHORT} money from the same entry at ${EXACTLY}`,
  );
  assertLessThanOrEqual(
    differing(cheapShort, cheapExactly, PLAINLY),
    STILL,
    `the Arc's entry, affordable at both, to be drawn the same way at ${SHORT} money as at ${EXACTLY}`,
  );
});
