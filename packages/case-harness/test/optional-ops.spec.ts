// The operations a build MAY carry: what the surface probe does with them, and
// what a check that reaches for one the build does not carry lands on.
//
// A case can have VARIANTS whose specifications differ in what they instrument,
// and one validator project decides all of them. A base build that carries none
// of a variant's operations is perfectly conformant, so `requiredOps` may not
// name them — the probe would report every base build as missing an operation and
// leave every point in the run undecided. Leaving them out of both lists is the
// other failure: a variant build that owes one and does not carry it fails its
// points with a raw `TypeError` from inside the page, several calls into a
// scenario, which names nothing a reviewer can act on.
//
// So they are PROBED BUT NEVER REQUIRED. The fixture build carries `bed` and
// carries no `setCharge`, so one page answers both halves.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  OPTIONAL_OPS,
  REQUIRED_OPS,
  createHarness,
  createVariantHarness,
  type VariantHarness,
} from "./fixture";

let h: VariantHarness;

beforeEach(async () => {
  h = await createVariantHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("does not fault a build for missing an operation it may omit", async () => {
  // The whole point. `setCharge` is declared by this case and carried by no build
  // here, and the surface is still whole: every point this project decides is
  // decided, rather than every one of them failing on a variant's operation the
  // build never owed.
  expect(OPTIONAL_OPS).toContain("setCharge");
  expect(h.surfaceFault).toBeNull();

  const probed = await h.probe([...REQUIRED_OPS, ...OPTIONAL_OPS]);
  for (const op of REQUIRED_OPS) expect(probed.ops[op], op).toBe("function");
  expect(probed.ops.bed).toBe("function");
  expect(probed.ops.setCharge).toBe("undefined");

  // And the game is drivable, which is the fact a surface fault would have taken
  // away from every check in the project.
  expect((await h.step(2)).frames).toBe(2);
});

it("hands over the optional operations the build DOES carry", async () => {
  // Being optional is not being unavailable: `bed` is on this build's surface and
  // reached exactly as any other operation is.
  await expect(h.debug.bed()).resolves.toBeUndefined();
});

it("fails a call to a missing one by NAMING it, on every route in", async () => {
  // The reading a reviewer gets instead of a `TypeError`: what the specification
  // required of the surface, and what was found. Every route into the surface a
  // check can take is stopped at the same place, because a route that was not
  // would land the check on a page-side crash whose message names nothing.
  // The `Actual:` line is the fault as a rendered VALUE, quotes and all, which is
  // the shape the runner extracts and the console shows the reviewer.
  const named =
    /Expected: a usable debug and automation surface[\s\S]*Actual: "window\.__fixture carries no setCharge\(\)"/;

  // 1. The surface proxy, which is how a check reaches an operation directly.
  await expect(h.debug.setCharge(3)).rejects.toThrow(named);

  // 2. A batch, where the raw failure would take the rest of the batch with it.
  await expect(h.arrange([["setCharge", 3]])).rejects.toThrow(named);

  // 3. A sweep's own arrangement, which runs in the sweep's crossing.
  await expect(
    h.sweep(() => true, null, { arrange: [["setCharge", 3]] }),
  ).rejects.toThrow(named);

  // 4. And the operations a probing run declares it may issue — which it names
  //    rather than hands over, because `stage` builds its calls inside the page
  //    where nothing here can read them off a batch.
  await expect(
    h.trials(1, {
      stage: () => [],
      read: (snapshot) => snapshot.frames,
      argument: null,
      operations: ["setCharge"],
    }),
  ).rejects.toThrow(named);

  // Nothing ran on any of the four: a refused call is a call the build never saw.
  expect(h.frame()).toBe(0);
  expect((await h.snapshot()).frames).toBe(0);
});

it("says nothing about an operation neither list named", async () => {
  // The honest answer: the harness was never told this operation should exist, so
  // it is not the harness's business to say it is missing. A call to one reaches
  // the page and fails there, which is what a check that invented an operation
  // deserves — and what a case's two lists exist to keep it from meeting.
  await expect(
    (h.debug as unknown as { neverDeclared(): Promise<void> }).neverDeclared(),
  ).rejects.toThrow(/is not a function/);
});

it("costs a case that declares none of them nothing at all", async () => {
  // The default kit names no optional operation, so the probe is skipped rather
  // than made against an empty list — and every operation is as unchecked here as
  // it was before this existed.
  const plain = await createHarness();
  try {
    expect(plain.surfaceFault).toBeNull();
    expect(plain.config.optionalOps).toEqual([]);
    await expect(
      (plain.debug as unknown as { setCharge(): Promise<void> }).setCharge(),
    ).rejects.toThrow(/is not a function/);
  } finally {
    await plain.dispose();
  }
});
