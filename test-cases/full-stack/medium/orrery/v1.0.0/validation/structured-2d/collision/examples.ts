// collision/examples — the worked examples of `specs/simulation.md`, posed.
//
// NOT A SUITE. No entry of `test-case.toml` names this file; it decides no point.
// It is the arrangement half of the checks in this directory, and it ASSERTS
// NOTHING: each poser stands the configuration up and hands back the ids, and the
// suite that called it reads the verdict.
//
// WHY ONE FILE. `specs/simulation.md` pins the collision rule with a table of
// worked configurations, and several of them are posed by more than one check —
// example A backs the freeze rule, the freeze itself, the faulted status and the
// fault's mote list as well as its own item, and example G backs "a collision names
// no part". Writing the configuration once means the geometry a check leans on is
// the geometry the specification wrote down, in one place, rather than a dozen
// transcriptions that could drift apart.
//
// TEN OF THE TWELVE ROWS ARE HERE. Rows E2 and I trace example E's distance
// profile exactly — `41.57` at `t = 4/8`, `48.00` at `t = 8/8`, clear — so E stands
// for all three and there is nothing a separate pose of either would decide.
//
// EVERY POSE IS AN ISOLATED WORLD. Each opens through `openBareRun` — reset, the
// posed challenge, an empty machine, the completion switch held off, a live run,
// and an EMPTY FIELD — then places back exactly the parts and motes its
// configuration names and nothing else. A hold is given with `setGrip`, "which
// takes hold with no `grab` ever running" (`specs/instrumentation.md`), so no
// `grab` cycle runs before the cycle under test; a part that must not move is left
// with a blank tape, "which every part rests on".
//
// THE COORDINATES ARE THE SPECIFICATION'S. Every hex, rotation, length and
// instruction below is read off the worked-example table of `specs/simulation.md`
// and the anatomy of `specs/parts.md` ("one gripper per spoke at
// `base + length * DIRS[d]`"), never off a reference.

import { at } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** What a posed example hands back: the ids its suite reads its verdict through. */
export interface Example {
  /** The parts placed, in placement order — the order `editor.parts` lists them. */
  readonly parts: readonly number[];
  /** The motes a gripper is holding when the cycle begins. */
  readonly carried: readonly number[];
  /** The motes resting on the field, held by nothing. */
  readonly resting: readonly number[];
}

/**
 * Example A — "An arm at `(0, 0)`, length 1, carries a mote from `(1, 0)` toward
 * `(0, 1)` with `rotate-cw`. A mote rests on `(1, 1)`."
 *
 * First sample within `38` at `36.10`, `t = 3/8`; nearest `35.14` at `t = 4/8`.
 * The run faults.
 */
export async function exampleA(h: Harness): Promise<Example> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  const [arm] = await partIds(h);
  const carried = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, arm as number, 0, carried);
  const resting = await spawnMote(h, at(1, 1), "dust");
  return { parts: [arm as number], carried: [carried], resting: [resting] };
}

/**
 * Example B — "The same sweep, with the resting mote on `(1, -1)`."
 *
 * No sample within `38`; nearest `53.33` at `t = 1/8`. Clear.
 */
export async function exampleB(h: Harness): Promise<Example> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  const [arm] = await partIds(h);
  const carried = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, arm as number, 0, carried);
  const resting = await spawnMote(h, at(1, -1), "dust");
  return { parts: [arm as number], carried: [carried], resting: [resting] };
}

/**
 * Example C — "An arm at `(0, 0)`, length 2, carries a mote from `(2, 0)` toward
 * `(0, 2)` with `rotate-cw`. A mote rests on `(1, 0)`."
 *
 * No sample within `38`; nearest `48.81` at `t = 1/8`. Clear.
 */
export async function exampleC(h: Harness): Promise<Example> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 2, ["rotate-cw"])]),
  });
  const [arm] = await partIds(h);
  const carried = await spawnMote(h, at(2, 0), "dust");
  await takeGrip(h, arm as number, 0, carried);
  const resting = await spawnMote(h, at(1, 0), "dust");
  return { parts: [arm as number], carried: [carried], resting: [resting] };
}

/**
 * Example D — "The same sweep, with the resting mote on `(1, 1)`."
 *
 * First sample within `38` at `37.16`, `t = 1/8`; nearest `12.86` at `t = 4/8`.
 * The run faults.
 */
export async function exampleD(h: Harness): Promise<Example> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 2, ["rotate-cw"])]),
  });
  const [arm] = await partIds(h);
  const carried = await spawnMote(h, at(2, 0), "dust");
  await takeGrip(h, arm as number, 0, carried);
  const resting = await spawnMote(h, at(1, 1), "dust");
  return { parts: [arm as number], carried: [carried], resting: [resting] };
}

/**
 * Example E — "A piston extends, carrying a mote from `(1, 0)` to `(2, 0)`. A mote
 * rests on `(2, -1)`."
 *
 * No sample within `38`; nearest `41.57` at `t = 4/8`. Clear.
 */
export async function exampleE(h: Harness): Promise<Example> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("piston", 0, 0, 0, 1, ["extend"])]),
  });
  const [piston] = await partIds(h);
  const carried = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, piston as number, 0, carried);
  const resting = await spawnMote(h, at(2, -1), "dust");
  return { parts: [piston as number], carried: [carried], resting: [resting] };
}

/**
 * Example F — "The same slide, with the resting mote on `(3, -1)`."
 *
 * No sample within `38`; nearest `48.00` at `t = 8/8`, which is rest separation.
 * Clear.
 */
export async function exampleF(h: Harness): Promise<Example> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("piston", 0, 0, 0, 1, ["extend"])]),
  });
  const [piston] = await partIds(h);
  const carried = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, piston as number, 0, carried);
  const resting = await spawnMote(h, at(3, -1), "dust");
  return { parts: [piston as number], carried: [carried], resting: [resting] };
}

/**
 * Example G — "Two arms swap two motes between `(1, 0)` and `(0, 1)`, one rotating
 * clockwise about `(0, 0)` and the other clockwise about `(1, 1)`."
 *
 * The arm anchored on `(0, 0)` at rotation `0` grips `(1, 0)`; the arm anchored on
 * `(1, 1)` at rotation `3` grips `(1, 1) + DIRS[3] = (0, 1)`. Clockwise, the first
 * carries its mote to `(0, 1)` and the second carries its mote to `(1, 0)`.
 *
 * First sample within `38` at `37.16`, `t = 1/8`; nearest `12.86` at `t = 4/8`.
 * The run faults.
 */
export async function exampleG(h: Harness): Promise<Example> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, 0, 1, ["rotate-cw"]),
      armPart("arm", 1, 1, 3, 1, ["rotate-cw"]),
    ]),
  });
  const [first, second] = await partIds(h);
  const east = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, first as number, 0, east);
  const southeast = await spawnMote(h, at(0, 1), "dust");
  await takeGrip(h, second as number, 3, southeast);
  return {
    parts: [first as number, second as number],
    carried: [east, southeast],
    resting: [],
  };
}

/**
 * Example H — "Two motes rest on `(0, 0)` and `(1, 0)`. Nothing moves."
 *
 * `48.00` at every sample. Clear. The machine is empty, which is the whole of
 * "nothing moves".
 */
export async function exampleH(h: Harness): Promise<Example> {
  await openBareRun(h, { challenge: BARE });
  const origin = await spawnMote(h, at(0, 0), "dust");
  const east = await spawnMote(h, at(1, 0), "dust");
  return { parts: [], carried: [], resting: [origin, east] };
}

/**
 * Example J — "Two arms on one track both advance east, carrying motes on `(0, 0)`
 * and `(1, 0)`."
 *
 * The track runs east along `r = 1`; each arm sits on one of its cells at rotation
 * `4` (`DIRS[4]` is `(0, -1)`), so their grippers are the row above, on `(0, 0)`
 * and `(1, 0)`. `advance` carries each base to the next cell and its held mote
 * with it, so the two motes keep the one hex between them.
 *
 * `48.00` at every sample. Clear.
 */
export async function exampleJ(h: Harness): Promise<Example> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([at(0, 1), at(1, 1), at(2, 1), at(3, 1)]),
      armPart("arm", 0, 1, 4, 1, ["advance"]),
      armPart("arm", 1, 1, 4, 1, ["advance"]),
    ]),
  });
  const [, leader, follower] = await partIds(h);
  const front = await spawnMote(h, at(0, 0), "dust");
  await takeGrip(h, leader as number, 4, front);
  const back = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, follower as number, 4, back);
  return {
    parts: [leader as number, follower as number],
    carried: [front, back],
    resting: [],
  };
}

/**
 * Example K — "An open track through `(-1, 0)`, `(0, 0)`, `(1, 0)`, `(2, 0)`,
 * `(3, 0)`. An arm at `(-1, 0)` carries a mote on `(0, 0)` and advances; an arm at
 * `(3, 0)` carries a mote on `(2, 0)` and recedes."
 *
 * Both grippers converge on `(1, 0)`: first sample within `38` at `36.00`,
 * `t = 5/8`; they meet at `0.00` at `t = 8/8`. The run faults.
 */
export async function exampleK(h: Harness): Promise<Example> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([at(-1, 0), at(0, 0), at(1, 0), at(2, 0), at(3, 0)]),
      armPart("arm", -1, 0, 0, 1, ["advance"]),
      armPart("arm", 3, 0, 3, 1, ["recede"]),
    ]),
  });
  const [, westward, eastward] = await partIds(h);
  const advancing = await spawnMote(h, at(0, 0), "dust");
  await takeGrip(h, westward as number, 0, advancing);
  const receding = await spawnMote(h, at(2, 0), "dust");
  await takeGrip(h, eastward as number, 3, receding);
  return {
    parts: [westward as number, eastward as number],
    carried: [advancing, receding],
    resting: [],
  };
}
