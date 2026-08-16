import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Gate, LadderRungInput } from "@test-cabinet/run-record/ladders";
import type { BackendClient } from "../../../client/clients";
import { BackendProvider } from "../../../client/context";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import {
  GateEditor,
  LADDER_AXIS_LABELS,
  RungListEditor,
  describeGate,
  gateExample,
  requiredRuns,
} from "./ladderPickers";

function galleryValue(): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

// A backend with an empty catalog: the rung list itself is what these tests are
// about, and the add-a-rung dropdowns only need to render.
function backendValue() {
  return {
    client: {
      listTestCases: async () => [],
      resolveVersion: async () => null,
    } as unknown as BackendClient,
    identity: null,
    status: "ready" as const,
    error: null,
    url: null,
    setUrl: () => {},
  };
}

function gate(over: Partial<Gate> = {}): Gate {
  return {
    floor: "scuffed",
    threshold: { kind: "count", runs: 1 },
    unloadedCountsAsBroken: true,
    earlyStop: false,
    ...over,
  };
}

// The ordering choice is named for what a reviewer gets out of it, never for the
// traversal it implements — the same rule the coverage plan's axis labels follow.
describe("ladder axis labels", () => {
  it("describes the climb, and never says depth- or breadth-first", () => {
    expect(LADDER_AXIS_LABELS.rung).toBe("Rung by rung");
    expect(LADDER_AXIS_LABELS.combination).toBe("Model by model");
    const wording = Object.values(LADDER_AXIS_LABELS).join(" ").toLowerCase();
    expect(wording).not.toMatch(/depth|breadth/);
  });
});

// The console re-derives the threshold only to *show* what a setting means before any
// run exists; it must round exactly as the Rust gate does or the preview would promise
// a bar the server does not apply.
describe("requiredRuns", () => {
  it("passes an absolute count straight through", () => {
    expect(requiredRuns({ kind: "count", runs: 2 }, 5)).toBe(2);
  });

  it("rounds a fraction up: half of five runs is three, not two", () => {
    expect(requiredRuns({ kind: "fraction", fraction: 0.5 }, 5)).toBe(3);
  });

  it("does not demand a run that cannot exist when the product is whole", () => {
    // 0.6 * 5 is 3.0000000000000004 in binary; the epsilon keeps it at three.
    expect(requiredRuns({ kind: "fraction", fraction: 0.6 }, 5)).toBe(3);
  });

  it("clamps a nonsense fraction rather than walling everyone forever", () => {
    expect(requiredRuns({ kind: "fraction", fraction: 5 }, 4)).toBe(4);
    expect(requiredRuns({ kind: "fraction", fraction: -1 }, 4)).toBe(0);
  });
});

// The gate is one parameterised rule, so its description reads the rule back rather
// than naming a mode — and the worked example is what makes the two knobs checkable
// together.
describe("describeGate / gateExample", () => {
  it("states an absolute threshold in runs", () => {
    expect(describeGate(gate())).toMatch(
      /advances past a rung once 1 of its runs is rated Scuffed or better/i,
    );
  });

  it("states a fractional threshold as a share of the completed runs", () => {
    const text = describeGate(
      gate({ threshold: { kind: "fraction", fraction: 0.5 } }),
    );
    expect(text).toMatch(/50% of its completed runs/i);
  });

  // The three intents the design is specified against, at five runs a rung.
  it("expresses “stop when all are broken” as floor scuffed, 1 run", () => {
    const text = gateExample(gate(), 5);
    expect(text).toMatch(
      /advances once 1 of its 5 runs is rated Scuffed or better/i,
    );
    expect(text).toMatch(/walled when 5 or more come back worse/i);
  });

  it("expresses “stop when over half are broken” as floor scuffed, 50%", () => {
    const text = gateExample(
      gate({ threshold: { kind: "fraction", fraction: 0.5 } }),
      5,
    );
    expect(text).toMatch(/advances once 3 of its 5 runs/i);
    expect(text).toMatch(/walled when 3 or more come back worse/i);
  });

  it("expresses “pass if any run is passable or better” as floor passable, 1 run", () => {
    const text = gateExample(gate({ floor: "passable" }), 5);
    expect(text).toMatch(/1 of its 5 runs is rated Passable or better/i);
  });

  it("says a rung finishes anyway unless early stop is on", () => {
    expect(gateExample(gate(), 5)).toMatch(/still finishes all of its runs/i);
    expect(gateExample(gate({ earlyStop: true }), 5)).toMatch(
      /remaining runs are cancelled/i,
    );
  });

  it("warns when the threshold demands nothing at all", () => {
    const text = gateExample(
      gate({ threshold: { kind: "fraction", fraction: 0 } }),
      5,
    );
    expect(text).toMatch(/demands nothing/i);
  });
});

// Two controls and no mode picker: the floor and the threshold are set directly, and
// switching the threshold's unit re-seeds it rather than reinterpreting the number.
describe("GateEditor", () => {
  function renderEditor(value: Gate, onChange = vi.fn()) {
    render(<GateEditor gate={value} runsPerCell={5} onChange={onChange} />);
    return onChange;
  }

  it("sets the rating floor without touching the threshold", () => {
    const onChange = renderEditor(gate());
    fireEvent.change(screen.getByLabelText("Counts as clearing the rung"), {
      target: { value: "passable" },
    });
    expect(onChange).toHaveBeenCalledWith(gate({ floor: "passable" }));
  });

  it("edits an absolute threshold in runs", () => {
    const onChange = renderEditor(gate());
    fireEvent.change(screen.getByLabelText("How many must clear it"), {
      target: { value: "3" },
    });
    expect(onChange).toHaveBeenCalledWith(
      gate({ threshold: { kind: "count", runs: 3 } }),
    );
  });

  it("edits a fractional threshold as a percentage and stores a share", () => {
    const onChange = renderEditor(
      gate({ threshold: { kind: "fraction", fraction: 0.5 } }),
    );
    fireEvent.change(screen.getByLabelText("How many must clear it"), {
      target: { value: "75" },
    });
    expect(onChange).toHaveBeenCalledWith(
      gate({ threshold: { kind: "fraction", fraction: 0.75 } }),
    );
  });

  it("re-seeds the amount when the unit changes, rather than carrying it across", () => {
    const onChange = renderEditor(
      gate({ threshold: { kind: "fraction", fraction: 0.5 } }),
    );
    fireEvent.change(screen.getByLabelText("Measured as"), {
      target: { value: "count" },
    });
    // 50 as a count would be fifty runs — an order of magnitude away from what the
    // reviewer was looking at.
    expect(onChange).toHaveBeenCalledWith(
      gate({ threshold: { kind: "count", runs: 1 } }),
    );
  });

  it("defaults unloaded-as-broken on and early stop off", () => {
    renderEditor(gate());
    expect(
      screen.getByLabelText(/never loaded as broken/i, { selector: "input" }),
    ).toBeChecked();
    expect(
      screen.getByLabelText(/cancel its remaining runs/i, {
        selector: "input",
      }),
    ).not.toBeChecked();
  });
});

// The rung list is a sequence, not a set: its order is the climb, so the editor's job
// is to make the order visible and movable.
describe("RungListEditor", () => {
  function rung(over: Partial<LadderRungInput> = {}): LadderRungInput {
    return { slug: "alpha", version: "v1.0.0", variant: "base", ...over };
  }

  // The catalog load is asynchronous even when it resolves empty, so every render
  // flushes it before asserting — otherwise its state update lands after the test has
  // finished, outside `act`.
  async function renderList(rungs: LadderRungInput[], onChange = vi.fn()) {
    render(
      <BackendProvider value={backendValue()}>
        <GalleryDataProvider value={galleryValue()}>
          <RungListEditor rungs={rungs} runsPerCell={3} onChange={onChange} />
        </GalleryDataProvider>
      </BackendProvider>,
    );
    await act(async () => {});
    return onChange;
  }

  it("numbers the rungs from one, in climb order", async () => {
    await renderList([rung({ id: "a" }), rung({ id: "b", slug: "zeta" })]);
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("moves a rung up without editing it", async () => {
    const onChange = await renderList([
      rung({ id: "a" }),
      rung({ id: "b", slug: "zeta" }),
    ]);
    fireEvent.click(screen.getByLabelText("Move rung 2 up"));
    expect(onChange).toHaveBeenCalledWith([
      rung({ id: "b", slug: "zeta" }),
      rung({ id: "a" }),
    ]);
  });

  it("cannot move the ends off the list", async () => {
    await renderList([rung({ id: "a" }), rung({ id: "b", slug: "zeta" })]);
    expect(screen.getByLabelText("Move rung 1 up")).toBeDisabled();
    expect(screen.getByLabelText("Move rung 2 down")).toBeDisabled();
  });

  it("removes the rung it was asked to remove", async () => {
    const onChange = await renderList([
      rung({ id: "a" }),
      rung({ id: "b", slug: "zeta" }),
    ]);
    fireEvent.click(screen.getByLabelText("Remove rung 1"));
    expect(onChange).toHaveBeenCalledWith([rung({ id: "b", slug: "zeta" })]);
  });

  it("inherits the ladder's target until a rung overrides it", async () => {
    const onChange = await renderList([rung({ id: "a" })]);
    const field = screen.getByLabelText("Runs for rung 1");
    // Empty shows the ladder's own target as the placeholder rather than a value,
    // because inheriting and choosing the same number are different instructions.
    expect(field).toHaveValue(null);
    expect(field).toHaveAttribute("placeholder", "3");
    fireEvent.change(field, { target: { value: "5" } });
    expect(onChange).toHaveBeenCalledWith([rung({ id: "a", runs: 5 })]);
  });

  it("never offers a case type whose gate could not resolve", async () => {
    await renderList([]);
    const options = Array.from(
      screen.getByLabelText("Test case type").querySelectorAll("option"),
    ).map((o) => o.textContent);
    expect(options).not.toContain("Performance");
    expect(options).not.toContain("Game Jams");
    expect(options).toContain("E2E");
  });
});
