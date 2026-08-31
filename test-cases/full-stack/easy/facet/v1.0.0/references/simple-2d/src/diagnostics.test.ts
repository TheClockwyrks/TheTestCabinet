import { describe, expect, it } from "vitest";
import { fromCore } from "./bridge";
import {
  createInitialState,
  loadBoard,
  poseSwap,
  setCursor,
  setSelection,
  startRound,
} from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";
import { registerDiagnostics } from "./diagnostics";
import type { FacetState } from "./game";
import type { InitApi } from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

type Source = (state: DeepReadonly<FacetState>) => unknown;

/** Every source the build registers, in registration order. */
function sources(): Map<string, Source> {
  const registered = new Map<string, Source>();
  registerDiagnostics({
    diagnostics: {
      register: (name: string, source: Source) => registered.set(name, source),
    },
  } as unknown as Pick<InitApi<FacetState>, "diagnostics">);
  return registered;
}

describe("the overlay's sources", () => {
  it("registers every value specs/instrumentation.md lists", () => {
    expect([...sources().keys()]).toEqual([
      "screen",
      "board",
      "score",
      "level",
      "chain",
      "last step",
      "cursor",
      "selection",
      "legal swap",
      "pointer",
    ]);
  });

  it("reads the state it is handed rather than one it closed over", () => {
    const registered = sources();
    const title = fromCore(createInitialState());
    const playing = fromCore(startRound(createInitialState()));

    expect(registered.get("screen")?.(title)).toBe("title / idle");
    expect(registered.get("screen")?.(playing)).toBe("playing / idle");
    expect(registered.get("board")?.(title)).toBe("0x0");
    expect(registered.get("board")?.(playing)).toBe("8x8");
  });

  it("reports the round's figures against what they are measured on", () => {
    const registered = sources();
    const state = fromCore({
      ...startRound(createInitialState()),
      score: 4321,
      level: 3,
      levelScore: 900,
      chainStep: 9,
      lastCleared: 5,
      lastPoints: 120,
    });

    expect(registered.get("score")?.(state)).toBe(4321);
    expect(registered.get("level")?.(state)).toBe("3  900/6000");
    // The multiplier caps at MAX_MULTIPLIER while the step keeps counting.
    expect(registered.get("chain")?.(state)).toBe("step 9  x8");
    expect(registered.get("last step")?.(state)).toBe("5 cells  120 pts");
  });

  it("reports the cursor, the selection, and a board with no swap on it", () => {
    const registered = sources();
    const posed = loadBoard(startRound(createInitialState()), quietRows());
    const placed = setSelection(setCursor(posed, 4, 5), 2, 3);
    const state = fromCore(placed);

    expect(registered.get("cursor")?.(state)).toBe("4,5");
    expect(registered.get("selection")?.(state)).toBe("2,3");
    // The quiet board carries no productive swap at all.
    expect(registered.get("legal swap")?.(state)).toBe(false);
  });

  it("reports no selection as a dash, and a live board as having a swap", () => {
    const registered = sources();
    const state = fromCore(
      loadBoard(
        startRound(createInitialState()),
        quietRowsWith({ "1,1": "R0", "2,1": "R0", "3,2": "R0", "3,1": "C0" }),
      ),
    );
    expect(registered.get("selection")?.(state)).toBe("-");
    expect(registered.get("legal swap")?.(state)).toBe(true);
  });

  it("reports the pointer, marking it while it is held", () => {
    const registered = sources();
    const up = fromCore({
      ...createInitialState(),
      pointer: { x: 640.4, y: 360.6, down: false },
    });
    const down = fromCore({
      ...createInitialState(),
      pointer: { x: 640.4, y: 360.6, down: true },
    });
    expect(registered.get("pointer")?.(up)).toBe("640, 361");
    expect(registered.get("pointer")?.(down)).toBe("640, 361 down");
  });

  it("changes nothing it reads", () => {
    const registered = sources();
    const posed = loadBoard(
      startRound(createInitialState()),
      quietRowsWith({ "1,1": "R0", "2,1": "R0", "3,2": "R0", "3,1": "C0" }),
    );
    const state = fromCore(poseSwap(posed, 3, 1, 3, 2));
    const before = JSON.stringify(state);
    for (const source of registered.values()) source(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});
