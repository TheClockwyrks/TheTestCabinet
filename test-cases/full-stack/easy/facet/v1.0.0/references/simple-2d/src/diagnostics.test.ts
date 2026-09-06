import { describe, expect, it } from "vitest";
import { fromCore } from "./bridge";
import {
  createInitialState,
  loadBoard,
  poseSwap,
  setOffer,
  setSelection,
  startRound,
} from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";
import { registerDiagnostics } from "./diagnostics";
import type { FacetState } from "./game";
import type { InitApi } from "@clockwyrks/simple-2d";
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
      "last motion",
      "selection",
      "offer",
      "best",
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
      bestMove: 640,
      bestChain: 4,
    });

    expect(registered.get("score")?.(state)).toBe(4321);
    expect(registered.get("level")?.(state)).toBe("3  900/6000");
    // The multiplier caps at MAX_MULTIPLIER while the step keeps counting.
    expect(registered.get("chain")?.(state)).toBe("step 9  x8");
    expect(registered.get("last step")?.(state)).toBe("5 cells  120 pts");
    expect(registered.get("best")?.(state)).toBe("move 640  chain 4");
  });

  it("reports what the most recent step set in motion", () => {
    const registered = sources();
    // A posed board stands exactly as it was written, so nothing has fallen.
    const posed = fromCore(
      loadBoard(startRound(createInitialState()), quietRows()),
    );
    expect(registered.get("last motion")?.(posed)).toBe("0 waves  0 rows");

    const dealt = fromCore(startRound(createInitialState()));
    expect(registered.get("last motion")?.(dealt)).toMatch(/0 waves {2}[1-9]/);
  });

  it("reports the selection, the offer, and a board with no swap on it", () => {
    const registered = sources();
    const posed = loadBoard(startRound(createInitialState()), quietRows());
    const held = setOffer(setSelection(posed, 2, 3), 2, 4);
    const state = fromCore(held);

    expect(registered.get("selection")?.(state)).toBe("2,3");
    expect(registered.get("offer")?.(state)).toBe("2,4");
    // The quiet board carries no productive swap at all.
    expect(registered.get("legal swap")?.(state)).toBe(false);
  });

  it("reports nothing held as a dash, and a live board as having a swap", () => {
    const registered = sources();
    const state = fromCore(
      loadBoard(
        startRound(createInitialState()),
        quietRowsWith({ "1,1": "R0", "2,1": "R0", "3,2": "R0", "3,1": "C0" }),
      ),
    );
    expect(registered.get("selection")?.(state)).toBe("-");
    expect(registered.get("offer")?.(state)).toBe("-");
    expect(registered.get("legal swap")?.(state)).toBe(true);
  });

  it("reports the pointer, its device, and whether it is held", () => {
    const registered = sources();
    const up = fromCore({
      ...createInitialState(),
      pointer: { x: 640.4, y: 360.6, down: false, device: "mouse" },
    });
    const down = fromCore({
      ...createInitialState(),
      pointer: { x: 640.4, y: 360.6, down: true, device: "touch" },
    });
    expect(registered.get("pointer")?.(up)).toBe("640, 361 mouse");
    expect(registered.get("pointer")?.(down)).toBe("640, 361 touch down");
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
