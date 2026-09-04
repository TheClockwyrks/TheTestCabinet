// instrumentation/invalid-enumerated-argument-fails-loudly — a name the
// specification does not give is not guessed at.
//
// specs/instrumentation.md § The operations opens the three rules that cover
// every operation with this one: "An argument outside the domain its operation
// states is invalid, and the call fails loudly rather than guessing what was
// meant."
//
// Six operations name a closed vocabulary between them — a tool, a screen, a
// material, an axis, a load class and a load phase — and each is called here with
// one word outside its own. They exercise one rule the same way, so they share
// one check; what a failure has to say is that the surface took a word the
// specification never gave it.
//
// EACH CALL IS MADE ON A SCREEN ITS OPERATION APPLIES ON, so the only thing that
// can be wrong with it is the argument. specs/instrumentation.md's third rule
// ("Each pose applies on the screens its section names and does nothing on any
// other") would otherwise be a second explanation for a call that did nothing,
// and this check is about the first rule alone. That is why the load phase is
// posed inside a real run: `setLoadPhase` is one of the run-in-progress poses,
// and its index is an index into the loads the run carries.
//
// And the snapshot is read either side of every call, because "rather than
// guessing what was meant" is the other half of the rule: a call that threw and
// still wrote something would have guessed.
//
// THE CRANE THE RUN NEEDS IS THE SMALLEST READY ONE, a slew ring and a single
// rail — nothing this point is about is decided by what holds them up.
// specs/structure.md § Readiness lists the four issues that refuse a run, this
// crane raises none of them, and "whether it stands is the solve's verdict, not
// the editor's: a ready structure may still be a mechanism". No tick is driven
// after the run starts, so the solve never gets a verdict to reach and the run
// this reads stands at tick `0`.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  startRun,
  type CraneDesign,
  type Harness,
} from "../harness";

/** A slew ring and one rail: the smallest crane specs/structure.md calls ready. */
const READY_CRANE: CraneDesign = {
  site: 0,
  name: "Ring and track",
  ring: [0, 2, 0],
  counterweights: [],
  members: [[[0, 4, 0], [4, 4, 0], "rail"]],
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * `call` fails loudly and writes nothing.
 *
 * The two halves of the rule in one reading: the call throws, and the whole
 * snapshot either side of it is the same reading, so nothing was guessed at on
 * the way out.
 */
async function assertInvalid(
  what: string,
  call: () => Promise<unknown>,
): Promise<void> {
  const before = await h.snapshot();
  let threw = false;
  try {
    await call();
  } catch {
    threw = true;
  }
  if (!threw) {
    fail(
      `${what} to fail loudly, being outside the domain its operation ` +
        "states (specs/instrumentation.md)",
      "the call returned instead",
    );
  }
  const changed = differingPaths(before, await h.snapshot());
  if (changed.length > 0) {
    fail(
      `${what} to change nothing, rather than guessing what was meant ` +
        "(specs/instrumentation.md)",
      `it changed ${changed.slice(0, 8).join(", ")}`,
    );
  }
}

it("refuses a tool, screen, material, axis, load class or phase it was never given", async () => {
  try {
    await openSite(h, 0);
    await emptyYard(h);

    // The build screen: where the tool and the structure poses apply.
    await assertInvalid('setTool("hammer")', () =>
      h.debug.setTool("hammer" as never),
    );
    await assertInvalid('setScreen("pause")', () =>
      h.debug.setScreen("pause" as never),
    );
    await assertInvalid('addMember(..., "beam")', () =>
      h.debug.addMember(0, 0, 0, 0, 2, 0, "beam" as never),
    );
    await assertInvalid('addLoad("pallet", ...)', () =>
      h.debug.addLoad("pallet" as never, 40, 4, 2, 0, 0),
    );

    // The program screen: where the tape poses apply.
    await h.debug.setScreen("program");
    await assertInvalid('addMoveStep("boom", ...)', () =>
      h.debug.addMoveStep("boom" as never, 1, 1),
    );
    await h.debug.setScreen("build");

    // And a run in progress, which is where `setLoadPhase` applies and where its
    // index names a load the run carries.
    await poseCrane(h, READY_CRANE);
    await addOneLoad(
      h,
      "crate",
      40,
      { x: 6, y: 2, z: 0, yaw: 0 },
      { x: -6, y: 2, z: 0, yaw: 0 },
    );
    await poseTape(h, [
      {
        kind: "move",
        commands: [
          { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
        ],
      },
    ]);
    await startRun(h);
    await assertInvalid('setLoadPhase(0, "floating")', () =>
      h.debug.setLoadPhase(0, "floating" as never),
    );
  } finally {
    // In a `finally`, so a check that fails still leaves the picture that
    // shows why.
    await h.capture(
      "invalid-enumerated-argument",
      "The run the six refused calls left untouched",
    );
  }
});

/** The dotted paths at which two JSON-shaped readings differ. */
function differingPaths(a: unknown, b: unknown, at = ""): string[] {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return [at === "" ? "(the whole reading)" : at];
    }
    return a.flatMap((item, i) => differingPaths(item, b[i], `${at}[${i}]`));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((key) =>
      differingPaths(a[key], b[key], at === "" ? key : `${at}.${key}`),
    );
  }
  return Object.is(a, b) ? [] : [at === "" ? "(the whole reading)" : at];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
