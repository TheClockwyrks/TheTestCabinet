// field/mote-roster-rejects-an-unknown-type — a type outside MOTES is refused.
//
// THE RULE. "`spawnMote(q, r, type)` — Adds one unbonded, unheld mote of `type`,
// A NAME FROM `MOTES` IN `specs/field.md`, resting on `(q, r)` with a fresh `id`"
// (`specs/instrumentation.md`, The run), under the rule the whole surface is
// written against: "an argument outside the domain its operation states is
// invalid, and the call fails loudly rather than guessing what was meant, except
// where an operation states that it normalizes or ignores the call". `spawnMote`
// states no normalizing and no ignoring, and `specs/field.md` closes the roster —
// "`MOTES` NAMES THE FIFTEEN TYPES" — so a sixteenth name is outside the domain.
//
// WHY IT MATTERS THAT IT THROWS RATHER THAN SHRUGS. Failing loudly and doing
// nothing are different outcomes, and a scenario cannot tell them apart from a
// call that returned quietly. A build that coerced an unknown name onto `dust`,
// or that added a mote carrying a type nothing else in the game understands,
// would leave every later reading of that field meaning something else.
//
// THE VERDICT is read in two parts, because either alone is passable by a build
// that got it wrong: the call raises, AND the field stands exactly as it did —
// the same motes, on the same hexes, under the same types, and no sixteenth.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field and the
// machine; two motes of known types go back on it, so "exactly as it stood" is a
// state with something in it rather than an empty one, and the refused call names
// a THIRD, vacant hex — so nothing but the unknown type can be what refused it
// ("a hex already holding a mote throws" is the other way `spawnMote` refuses).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { MOTES, type MoteName } from "../constants";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  moteById,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

/** A type name that is not one of the fifteen `MOTES` names. */
const NOT_A_MOTE = "quasar";

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a type outside MOTES and leaves sim.motes exactly as it stood", async () => {
  assertTrue(
    !(MOTES as readonly string[]).includes(NOT_A_MOTE),
    `${NOT_A_MOTE} is not one of the fifteen names MOTES holds`,
  );

  await openBareRun(h, { challenge: BARE });
  const dust = await spawnMote(h, WEST, "dust");
  const sol = await spawnMote(h, EAST, "sol");

  let raised = false;
  try {
    await h.debug.spawnMote(
      ORIGIN.q,
      ORIGIN.r,
      NOT_A_MOTE as unknown as MoteName,
    );
  } catch {
    raised = true;
  }

  await h.advance(1);
  await captureStill(h, "unchanged");

  assertTrue(
    raised,
    "spawnMote takes a name from MOTES, so a name outside it fails loudly",
  );

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.sim?.motes ?? [],
    2,
    "the refused call added no mote, so the field holds the two it held before",
  );
  assertEqual(
    snapshot.sim?.motes.find(
      (mote) => mote.q === ORIGIN.q && mote.r === ORIGIN.r,
    ) ?? null,
    null,
    "the hex the refused call named is still vacant",
  );

  const west = moteById(snapshot, dust);
  assertNotNull(
    west,
    "the dust spawned before the refused call is still there",
  );
  assertEqual(west?.type, "dust", "and still under its own type");
  assertEqual(west?.q, WEST.q, "and still on its own hex, q");
  assertEqual(west?.r, WEST.r, "and still on its own hex, r");

  const east = moteById(snapshot, sol);
  assertNotNull(east, "the sol spawned before the refused call is still there");
  assertEqual(east?.type, "sol", "and still under its own type");
  assertEqual(east?.q, EAST.q, "and still on its own hex, q");
  assertEqual(east?.r, EAST.r, "and still on its own hex, r");
});
