// collision/example-j-convoy-clears — worked example J of `specs/simulation.md`.
//
// THE RULE. Two motes carried by the same translation keep the vector between
// them: "`advance`, `recede` — The base translates to the adjacent track cell ...
// Translation by the same vector, linearly in `t`" (`specs/simulation.md`, Motion
// and carrying). A pair that starts one hex apart therefore stands `HEX_PITCH`
// (`48`) apart at every sample, and `48` is not within the `38` the collision rule
// fixes.
//
// THE CONFIGURATION, quoted from the worked-example table: "Two arms on one track
// both advance east, carrying motes on `(0, 0)` and `(1, 0)`." First sample within
// `38`: "none". Nearest sampled approach: `48.00` at every sample. Outcome:
// "Clear".
//
// The track runs east along `r = 1` and each arm is mounted on one of its cells at
// rotation `4`; `DIRS[4]` is `(0, -1)` (`specs/field.md`), so each gripper stands
// one hex north of its base, on `(0, 0)` and `(1, 0)`. "An arm or wheel whose
// anchor hex is a cell of a track is mounted on that track" (`specs/parts.md`), and
// `advance` carries each base to the next cell with its held mote.
//
// THE VERDICT. The cycle reaches its boundary — `sim.cycle` at `1`, `sim.status`
// `running`, `sim.fault` `null` — and both motes have travelled one hex east, so
// the convoy really did move rather than clearing by standing still.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull, assertNull } from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
  type Harness,
} from "../harness";
import { exampleJ } from "./examples";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances two carried motes in convoy without closing the hex between them", async () => {
  const posed = await exampleJ(h);

  await captureReplay(h, "clear", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(
    sim?.status,
    "running",
    "a convoy under one translation holds 48.00 at every sample, which is not within 38",
  );
  assertNull(
    sim?.fault ?? null,
    "a run that reached no sample within 38 raises no fault",
  );
  assertEqual(
    sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a completed cycle leaves the fraction on the boundary it reached",
  );
  const [front, back] = posed.carried;
  assertEqual(
    `${moteById(snapshot, front as number)?.q},${moteById(snapshot, front as number)?.r}`,
    "1,0",
    "advance carried the leading mote one cell east with its arm's base",
  );
  assertEqual(
    `${moteById(snapshot, back as number)?.q},${moteById(snapshot, back as number)?.r}`,
    "2,0",
    "advance carried the following mote one cell east with its arm's base",
  );
});
