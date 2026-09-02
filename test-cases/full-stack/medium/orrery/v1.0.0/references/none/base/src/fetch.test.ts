import { describe, expect, it } from "vitest";

import { createStateOps, type OrreryStateOps } from "./debug";
import {
  fetchCycle,
  imposedMotion,
  poseAfter,
  trackStep,
  type PartStep,
} from "./fetch";
import { Game } from "./game";
import { createPart } from "./machine";
import { rotationMotion, translationMotion, REST } from "./motion";
import type { FaultKind, Hex, PartState, Pose, TapeCell } from "./types";

/** One placed part, with the tape and length the example gives it. */
function placed(
  id: number,
  kind: PartState["kind"],
  q: number,
  r: number,
  rotation: number,
  options: { tape?: TapeCell[]; length?: number } = {},
): PartState {
  return createPart(id, kind, q, r, rotation, options);
}

/** One track, laid along the cells given. */
function track(id: number, cells: Hex[], closed = false): PartState {
  return createPart(id, "track", cells[0].q, cells[0].r, 0, { cells, closed });
}

/** A part's rest pose, which is where every run starts it. */
function restPose(part: PartState): Pose {
  return {
    part: part.id,
    rotation: part.rotation,
    length: part.length,
    cell: { q: part.q, r: part.r },
  };
}

/** Fetch one cycle over a whole machine, from every part's rest pose. */
function fetchAt(
  parts: PartState[],
  cycle: number,
): ReturnType<typeof fetchCycle> {
  return fetchCycle(parts, parts.map(restPose), cycle);
}

/** The step one part took, or the failure that it took none. */
function stepOf(steps: readonly PartStep[], id: number): PartStep {
  const step = steps.find((entry) => entry.part.id === id);
  if (step === undefined) throw new Error(`part ${id} fetched no step`);
  return step;
}

describe("reading the tape (specs/instructions.md, specs/simulation.md)", () => {
  it("gives every part cell `c mod P` of its own tape", () => {
    const long = placed(1, "arm", 0, 0, 0, {
      tape: ["grab", "rotate-cw", "drop"],
    });
    const short = placed(2, "arm", 2, 0, 0, { tape: ["drop", "grab"] });
    const parts = [long, short];
    // `P` is the longest tape: three.
    expect(fetchAt(parts, 0).steps.map((step) => step.cell)).toEqual([
      "grab",
      "drop",
    ]);
    expect(fetchAt(parts, 1).steps.map((step) => step.cell)).toEqual([
      "rotate-cw",
      "grab",
    ]);
    // Cell `2` is past the short tape's own length, so it is blank there.
    expect(fetchAt(parts, 2).steps.map((step) => step.cell)).toEqual([
      "drop",
      null,
    ]);
    // And cycle `3` wraps to cell `0` on both.
    expect(fetchAt(parts, 3).steps.map((step) => step.cell)).toEqual([
      "grab",
      "drop",
    ]);
  });

  it("rests every part when every tape is empty, on a period of one", () => {
    const parts = [placed(1, "arm", 0, 0, 0), placed(2, "wheel", 3, 0, 0)];
    for (const cycle of [0, 1, 7]) {
      const fetched = fetchAt(parts, cycle);
      expect(fetched.fault).toBeNull();
      expect(fetched.steps.map((step) => step.cell)).toEqual([null, null]);
    }
  });

  it("fetches nothing for a part that carries no tape", () => {
    const parts = [placed(1, "bind", 0, 0, 0), track(2, [{ q: 2, r: 0 }])];
    expect(fetchAt(parts, 0).steps).toEqual([]);
  });
});

describe("the fetch faults (specs/simulation.md Faults)", () => {
  /** The fault one part's tape raises on cycle `0`, or `null`. */
  function faultOf(parts: PartState[]): FaultKind | null {
    return fetchAt(parts, 0).fault?.kind ?? null;
  }

  it("never faults on a blank cell, a wheel included", () => {
    expect(faultOf([placed(1, "wheel", 0, 0, 0, { tape: [] })])).toBeNull();
  });

  it("raises `impossible` on anything but a rotation on a wheel", () => {
    for (const cell of [
      "grab",
      "drop",
      "pivot-cw",
      "extend",
      "retract",
      "advance",
    ] as const) {
      expect(faultOf([placed(1, "wheel", 0, 0, 0, { tape: [cell] })])).toBe(
        "impossible",
      );
    }
    for (const cell of ["rotate-cw", "rotate-ccw"] as const) {
      expect(
        faultOf([placed(1, "wheel", 0, 0, 0, { tape: [cell] })]),
      ).toBeNull();
    }
  });

  it("takes the wheel rule ahead of every other row", () => {
    // A wheel standing on a track is still `impossible`, never `track-end`.
    const cells = [{ q: 0, r: 0 }];
    expect(
      faultOf([
        track(1, cells),
        placed(2, "wheel", 0, 0, 0, { tape: ["advance"] }),
      ]),
    ).toBe("impossible");
  });

  it("raises `impossible` on `extend` or `retract` off a piston", () => {
    for (const kind of ["arm", "biarm", "triarm", "hexarm"] as const) {
      expect(faultOf([placed(1, kind, 0, 0, 0, { tape: ["extend"] })])).toBe(
        "impossible",
      );
      expect(faultOf([placed(1, kind, 0, 0, 0, { tape: ["retract"] })])).toBe(
        "impossible",
      );
    }
  });

  it("raises `overextended` at ARM_MAX_LEN and nothing below it", () => {
    expect(
      faultOf([placed(1, "piston", 0, 0, 0, { tape: ["extend"], length: 3 })]),
    ).toBe("overextended");
    expect(
      faultOf([placed(1, "piston", 0, 0, 0, { tape: ["extend"], length: 2 })]),
    ).toBeNull();
  });

  it("raises `overretracted` at ARM_MIN_LEN and nothing above it", () => {
    expect(
      faultOf([placed(1, "piston", 0, 0, 0, { tape: ["retract"], length: 1 })]),
    ).toBe("overretracted");
    expect(
      faultOf([placed(1, "piston", 0, 0, 0, { tape: ["retract"], length: 2 })]),
    ).toBeNull();
  });

  it("reads the bounds off the live pose rather than the placed length", () => {
    const piston = placed(1, "piston", 0, 0, 0, {
      tape: ["extend"],
      length: 1,
    });
    const stretched: Pose = { ...restPose(piston), length: 3 };
    expect(fetchCycle([piston], [stretched], 0).fault?.kind).toBe(
      "overextended",
    );
  });

  it("raises `unmounted` on `advance` or `recede` off a track", () => {
    expect(faultOf([placed(1, "arm", 0, 0, 0, { tape: ["advance"] })])).toBe(
      "unmounted",
    );
    expect(faultOf([placed(1, "arm", 0, 0, 0, { tape: ["recede"] })])).toBe(
      "unmounted",
    );
  });

  it("raises `track-end` past either end of an open track", () => {
    const path = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ];
    expect(
      faultOf([
        track(1, path),
        placed(2, "arm", 0, 0, 0, { tape: ["recede"] }),
      ]),
    ).toBe("track-end");
    expect(
      faultOf([
        track(1, path),
        placed(2, "arm", 1, 0, 0, { tape: ["advance"] }),
      ]),
    ).toBe("track-end");
    expect(
      faultOf([
        track(1, path),
        placed(2, "arm", 0, 0, 0, { tape: ["advance"] }),
      ]),
    ).toBeNull();
  });

  it("never reaches an end on a closed track", () => {
    const loop = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
    ];
    for (const cell of ["advance", "recede"] as const) {
      expect(
        faultOf([
          track(1, loop, true),
          placed(2, "arm", 0, 0, 0, { tape: [cell] }),
        ]),
      ).toBeNull();
    }
  });

  it("raises the fault of the earliest faulting part, and names it", () => {
    const parts = [
      placed(1, "arm", 0, 0, 0),
      placed(2, "arm", 2, 0, 0, { tape: ["advance"] }),
      placed(3, "arm", 4, 0, 0, { tape: ["extend"] }),
    ];
    const fetched = fetchAt(parts, 0);
    expect(fetched.fault).toEqual({
      kind: "unmounted",
      parts: [2],
      motes: [],
    });
  });
});

describe("the pose a cell leaves behind (specs/simulation.md)", () => {
  const base = restPose(placed(1, "piston", 0, 0, 2, { length: 2 }));

  it("steps the direction on a rotation, wrapping at six", () => {
    expect(poseAfter(base, "rotate-cw", []).rotation).toBe(3);
    expect(poseAfter(base, "rotate-ccw", []).rotation).toBe(1);
    expect(poseAfter({ ...base, rotation: 5 }, "rotate-cw", []).rotation).toBe(
      0,
    );
  });

  it("steps the length on `extend` and `retract`", () => {
    expect(poseAfter(base, "extend", []).length).toBe(3);
    expect(poseAfter(base, "retract", []).length).toBe(1);
  });

  it("leaves the pose alone on a pivot, a grab, a drop, and a blank", () => {
    for (const cell of ["pivot-cw", "pivot-ccw", "grab", "drop", null] as const)
      expect(poseAfter(base, cell, [])).toEqual(base);
  });

  it("steps along the track on `advance` and `recede`, wrapping when closed", () => {
    const loop = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
    ];
    const parts = [track(9, loop, true)];
    expect(trackStep({ q: 0, r: 0 }, true, parts)).toEqual({ q: 1, r: 0 });
    expect(trackStep({ q: 0, r: 0 }, false, parts)).toEqual({ q: 0, r: 1 });
    expect(trackStep({ q: 0, r: 1 }, true, parts)).toEqual({ q: 0, r: 0 });
  });

  it("leaves a part standing where it is when it is on no track", () => {
    expect(trackStep({ q: 4, r: 0 }, true, [])).toEqual({ q: 4, r: 0 });
  });
});

describe("the motion a cell imposes (specs/simulation.md)", () => {
  it("rotates a carried constellation about the part's base", () => {
    const arm = placed(1, "arm", 2, -1, 0, { tape: ["rotate-cw"] });
    const step = stepOf(fetchAt([arm], 0).steps, 1);
    expect(step.carried).toEqual(rotationMotion({ q: 2, r: -1 }, 1));
    expect(imposedMotion(step, 0)).toEqual(rotationMotion({ q: 2, r: -1 }, 1));
  });

  it("pivots a carried constellation about the holding gripper's hex", () => {
    const biarm = placed(1, "biarm", 0, 0, 0, { tape: ["pivot-ccw"] });
    const step = stepOf(fetchAt([biarm], 0).steps, 1);
    // The center is per gripper, so the step itself resolves none.
    expect(step.carried).toBeNull();
    expect(imposedMotion(step, 0)).toEqual(rotationMotion({ q: 1, r: 0 }, -1));
    expect(imposedMotion(step, 3)).toEqual(rotationMotion({ q: -1, r: 0 }, -1));
  });

  it("translates along the spoke on `extend` and back on `retract`", () => {
    const out = placed(1, "piston", 0, 0, 1, { tape: ["extend"] });
    expect(stepOf(fetchAt([out], 0).steps, 1).carried).toEqual(
      translationMotion({ q: 0, r: 1 }),
    );
    const back = placed(1, "piston", 0, 0, 1, {
      tape: ["retract"],
      length: 2,
    });
    expect(stepOf(fetchAt([back], 0).steps, 1).carried).toEqual(
      translationMotion({ q: 0, r: -1 }),
    );
  });

  it("translates by the track step on `advance` and `recede`", () => {
    const path = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ];
    const parts = [
      track(1, path),
      placed(2, "arm", 0, 0, 0, {
        tape: ["advance"],
      }),
    ];
    expect(stepOf(fetchAt(parts, 0).steps, 2).carried).toEqual(
      translationMotion({ q: 1, r: 0 }),
    );
  });

  it("imposes no motion on a grab, a drop, and a blank", () => {
    for (const cell of ["grab", "drop", null] as const) {
      const arm = placed(1, "arm", 0, 0, 0, {
        tape: cell === null ? [] : [cell],
      });
      expect(stepOf(fetchAt([arm], 0).steps, 1).carried).toEqual(REST);
    }
  });
});

describe("a fetch fault halts the run (specs/simulation.md)", () => {
  /** Place one part on `(0, 0)` carrying `cell` alone, and report its id. */
  function armed(
    api: OrreryStateOps,
    game: Game,
    kind: PartState["kind"],
    cell: TapeCell,
  ): number {
    api.placePart(kind, 0, 0, 0);
    const parts = game.state.editor.parts;
    const part = parts[parts.length - 1].id;
    api.setTapeCell(part, 0, cell);
    return part;
  }

  /** Extras 1, with one arm carrying `tape`, run for one cycle. */
  function raised(
    kind: PartState["kind"],
    tape: TapeCell[],
    pose: (api: OrreryStateOps, part: number) => void = () => {},
  ): Game {
    const game = new Game();
    const api = createStateOps(game);
    api.openChallenge("extras", 0);
    api.placePart(kind, 0, 0, 0);
    const part = game.state.editor.parts[0].id;
    for (const [col, cell] of tape.entries()) api.setTapeCell(part, col, cell);
    api.startRun();
    pose(api, part);
    api.setSpeed(0);
    game.update(1);
    return game;
  }

  it("freezes the run at fraction 0 and names the part", () => {
    const game = raised("arm", ["extend"]);
    expect(game.state.sim?.status).toBe("faulted");
    expect(game.state.sim?.fraction).toBe(0);
    expect(game.state.sim?.cycle).toBe(0);
    expect(game.state.sim?.fault).toEqual({
      kind: "impossible",
      parts: [game.state.editor.parts[0].id],
      motes: [],
    });
  });

  it("halts before any gripper opens or closes", () => {
    // The arm's own cell faults, so the grip it stood with is untouched.
    const game = new Game();
    const api = createStateOps(game);
    api.openChallenge("extras", 0);
    api.placePart("arm", 0, 0, 0);
    const arm = game.state.editor.parts[0].id;
    api.setTapeCell(arm, 0, "drop");
    api.placePart("arm", 3, 0, 0);
    const broken = game.state.editor.parts[1].id;
    api.setTapeCell(broken, 0, "advance");
    api.startRun();
    api.spawnMote(1, 0, "dust");
    const mote = game.state.sim?.motes[0].id ?? 0;
    api.setGrip(arm, 0, mote);
    api.setSpeed(0);
    game.update(1);
    expect(game.state.sim?.status).toBe("faulted");
    expect(game.state.sim?.fault?.kind).toBe("unmounted");
    expect(game.state.sim?.grips).toEqual([{ part: arm, spoke: 0, mote }]);
  });

  it("raises each of the five fetch faults through the run, naming its part", () => {
    const cases: {
      readonly kind: FaultKind;
      readonly pose: (api: OrreryStateOps, game: Game) => number;
    }[] = [
      {
        kind: "impossible",
        pose: (api, game) => armed(api, game, "arm", "extend"),
      },
      {
        kind: "overextended",
        pose: (api, game) => {
          const part = armed(api, game, "piston", "extend");
          api.setPartLength(part, 3);
          return part;
        },
      },
      {
        kind: "overretracted",
        pose: (api, game) => armed(api, game, "piston", "retract"),
      },
      {
        kind: "unmounted",
        pose: (api, game) => armed(api, game, "arm", "advance"),
      },
      {
        kind: "track-end",
        pose: (api, game) => {
          api.placeTrack(0, 0);
          return armed(api, game, "arm", "recede");
        },
      },
    ];
    for (const posed of cases) {
      const game = new Game();
      const api = createStateOps(game);
      api.openChallenge("extras", 0);
      const part = posed.pose(api, game);
      api.startRun();
      api.setSpeed(0);
      game.update(1);
      expect(game.state.sim?.fault).toEqual({
        kind: posed.kind,
        parts: [part],
        motes: [],
      });
      expect(game.state.sim?.status).toBe("faulted");
      expect(game.state.sim?.fraction).toBe(0);
    }
  });

  it("advances nothing further once it has frozen", () => {
    const game = raised("piston", ["retract"]);
    game.update(10);
    expect(game.state.sim?.status).toBe("faulted");
    expect(game.state.sim?.cycle).toBe(0);
    expect(game.state.sim?.fault?.kind).toBe("overretracted");
  });
});
