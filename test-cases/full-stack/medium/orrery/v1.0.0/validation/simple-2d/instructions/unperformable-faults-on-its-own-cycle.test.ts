// instructions/unperformable-faults-on-its-own-cycle — a tape is not scanned for
// faults when the run starts; each cell faults on the cycle that fetches it.
//
// THE RULE. "an instruction the executing part cannot perform faults the run at
// the moment it is fetched" (`specs/instructions.md`, The instruction set), and a
// cell is fetched at the start of its own cycle: "On cycle `c`, counted from `0`,
// each part executes the cell at index `c` modulo `P` of its own tape"
// (Tapes and the period), which `specs/simulation.md` opens the cycle with —
// "1. Fetch. Each part reads its tape cell for this cycle." Starting a run does
// three things, and none of them reads a tape: "Every arm and wheel takes its
// rest pose ... The settle runs ... The cycle counter starts at `0`"
// (The run).
//
// THE CONFIGURATION. One plain arm at the origin, on an otherwise empty machine
// and an empty field, whose tape holds blanks at columns `0`, `1` and `2` and
// `extend` at column `3`. The tape's length is `4` — "A tape's length is the
// index of its last non-blank cell plus one" — so it is the machine's period,
// and cycles `0`, `1` and `2` fetch blanks while cycle `3` fetches the `extend`
// that an arm which is not a piston cannot perform ("`impossible` — `extend` or
// `retract` on a part that is not a piston").
//
// THE VERDICT, read at four moments. At the moment the run stands up, before any
// cycle has run, `sim.status` is `running` and `sim.fault` is `null`: the tape
// was not scanned. Cycles `0`, `1` and `2` each reach their boundary, leaving
// `sim.cycle` at `1`, `2` and `3` with the status still `running` — "A blank cell
// is a rest on every part, a wheel included, and never faults". Cycle `3` faults
// as `impossible`, and "A completing or faulting boundary leaves `sim.cycle` at
// the cycle just run", so the counter stays at `3`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs cycles 0, 1 and 2 out and faults as impossible only when cycle 3 fetches the cell", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [null, null, null, "extend"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  const opened = await h.snapshot();
  assertNotNull(opened.sim, "the run is live once it has started");
  assertEqual(
    opened.editor.period,
    4,
    "the arm's tape is the machine's only tape, and its last non-blank cell is at index 3",
  );
  assertEqual(
    opened.sim?.status,
    "running",
    "the run stands up running: starting a run reads no tape",
  );
  assertNull(
    opened.sim?.fault ?? null,
    "a tape is not scanned for faults when the run starts",
  );

  const seen = await captureReplay(h, "late-fault", async () => {
    const states: OrrerySnapshot[] = [];
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await advanceCycles(h, 1);
      states.push(await h.snapshot());
    }
    await h.advance(1);
    return states;
  });

  for (const cycle of [0, 1, 2]) {
    const state = seen[cycle];
    assertNotNull(state?.sim ?? null, `the run is live through cycle ${cycle}`);
    assertEqual(
      state?.sim?.status,
      "running",
      `cycle ${cycle} fetches a blank, which is a rest and never faults`,
    );
    assertNull(
      state?.sim?.fault ?? null,
      `cycle ${cycle} raises no fault, though the tape already holds the extend`,
    );
    assertEqual(
      state?.sim?.cycle,
      cycle + 1,
      `cycle ${cycle} reaches its boundary`,
    );
  }

  const last = seen[3];
  assertNotNull(last?.sim ?? null, "the run is still live after the fault");
  assertEqual(
    last?.sim?.status,
    "faulted",
    "cycle 3 fetches the extend, which a part that is not a piston cannot perform",
  );
  assertEqual(
    last?.sim?.fault?.kind,
    "impossible",
    "extend on a part that is not a piston faults as impossible",
  );
  assertEqual(
    last?.sim?.cycle,
    3,
    "a faulting boundary leaves sim.cycle at the cycle just run",
  );
  assertDeepEqual(
    last?.sim?.fault?.parts,
    [arm],
    "the fetch fault names the arm whose cell it refused",
  );
});
