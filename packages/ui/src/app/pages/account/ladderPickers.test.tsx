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
  LadderAxisPicker,
  RungListEditor,
  describeGate,
  gateExample,
  requiredRuns,
  rungInput,
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

// A backend that actually resolves a case, for the add-a-rung half: the Engine
// dropdown offers exactly what the resolved version declares support for, so a test
// about the engine has to have a version to resolve.
function catalogValue(engines: string[]) {
  return {
    client: {
      listTestCases: async () => [
        { slug: "alpha", versions: ["v1.0.0"], name: "Alpha" },
      ],
      resolveVersion: async () => ({
        slug: "alpha",
        version: "v1.0.0",
        name: "Alpha",
        variants: [{ slug: "base", name: "Base" }],
        engines,
        maxRuntimeSeconds: 600,
      }),
    } as unknown as BackendClient,
    identity: null,
    status: "ready" as const,
    error: null,
    url: null,
    setUrl: () => {},
  };
}

/** The one case the catalog above offers, so the add-row's category filter shows it. */
function catalogGalleryValue(): GalleryDataInput {
  return {
    ...galleryValue(),
    testCases: [
      {
        slug: "alpha",
        name: "Alpha",
        testType: "end-to-end",
        assetKind: null,
        difficulty: "easy",
        tags: [],
        summary: null,
        versions: ["v1.0.0"],
        latestVersion: "v1.0.0",
      },
    ],
  } as unknown as GalleryDataInput;
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

// One setting with one answer, sat in a column of other settings, so it reads as a
// setting row whose control column shows that answer rather than as two pills.
describe("LadderAxisPicker", () => {
  function order(): HTMLSelectElement {
    return screen.getByLabelText("Climb order") as HTMLSelectElement;
  }

  it("shows the current order as the row's value and offers the other", () => {
    render(<LadderAxisPicker value="rung" onChange={vi.fn()} />);
    expect(order().value).toBe("rung");
    expect(Array.from(order().options).map((o) => o.textContent)).toEqual([
      "Rung by rung",
      "Model by model",
    ]);
  });

  it("reports the order that was picked", () => {
    const onChange = vi.fn();
    render(<LadderAxisPicker value="rung" onChange={onChange} />);
    fireEvent.change(order(), { target: { value: "combination" } });
    expect(onChange).toHaveBeenCalledWith("combination");
  });

  it("describes the selected order, not the one beside it", () => {
    const { rerender } = render(
      <LadderAxisPicker value="rung" onChange={vi.fn()} />,
    );
    expect(screen.getByText(/before anyone moves on/i)).toBeTruthy();
    rerender(<LadderAxisPicker value="combination" onChange={vi.fn()} />);
    expect(screen.getByText(/as high as it can/i)).toBeTruthy();
  });

  // Which order a ladder starts in is not written on the row, so the reset control is
  // the only thing that says the ladder is no longer as it came.
  it("offers a reset only once the order has moved off the default", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <LadderAxisPicker value="rung" onChange={onChange} />,
    );
    expect(
      screen.queryByRole("button", { name: "Reset Climb order" }),
    ).toBeNull();
    rerender(<LadderAxisPicker value="combination" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset Climb order" }));
    expect(onChange).toHaveBeenCalledWith("rung");
  });
});

// The console re-derives the threshold only to *show* what a setting means before any
// run exists; it must round exactly as the Rust gate does or the preview would promise
// a bar the server does not apply.
// A save rewrites the climb whole, so this projection decides what an edit keeps. It
// is shared by the editor's load and the dashboard's version bump precisely because a
// field one of them forgot is a field the ladder loses.
describe("rungInput", () => {
  const stored = {
    id: "r1",
    slug: "alpha",
    version: "v1.0.0",
    variant: "base",
  };

  it("keeps the stable id, which is what a climber's verdicts hang off", () => {
    expect(rungInput(stored).id).toBe("r1");
  });

  it("carries the engine through, rather than re-pinning the rung to the engineless run", () => {
    expect(rungInput({ ...stored, engine: "simple-2d" })).toEqual({
      id: "r1",
      slug: "alpha",
      version: "v1.0.0",
      variant: "base",
      engine: "simple-2d",
    });
  });

  it("carries a rung's own run override through", () => {
    expect(rungInput({ ...stored, runs: 7 }).runs).toBe(7);
  });

  it("omits an absent engine and run override rather than sending them as null", () => {
    // Absent is how the wire spells "the engineless run" and "inherit the ladder's
    // target"; a null would be a different instruction on both.
    expect(rungInput(stored)).toEqual({
      id: "r1",
      slug: "alpha",
      version: "v1.0.0",
      variant: "base",
    });
    expect("engine" in rungInput(stored)).toBe(false);
    expect("runs" in rungInput(stored)).toBe(false);
  });
});

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

  // A rung pins an engine for the same reason a plan's case does, and one extra: a
  // climb may legitimately hold the same case twice when the two rungs name different
  // engines, because clearing a case on a runtime is a different achievement.
  describe("the engine a rung pins", () => {
    async function renderAdd(
      rungs: LadderRungInput[] = [],
      engines: string[] = ["none", "simple-2d"],
      onChange = vi.fn(),
    ) {
      render(
        <BackendProvider value={catalogValue(engines)}>
          <GalleryDataProvider value={catalogGalleryValue()}>
            <RungListEditor rungs={rungs} runsPerCell={3} onChange={onChange} />
          </GalleryDataProvider>
        </BackendProvider>,
      );
      await act(async () => {});
      return onChange;
    }

    const engineSelect = () =>
      screen.getByLabelText("Engine") as HTMLSelectElement;

    it("offers the engines the resolved version supports", async () => {
      await renderAdd();
      expect([...engineSelect().options].map((o) => o.textContent)).toEqual([
        "None",
        "Simple 2D",
      ]);
    });

    it("names a single supported engine read-only rather than hiding it", async () => {
      await renderAdd([], ["structured-2d"]);
      expect(engineSelect().value).toBe("structured-2d");
      expect(engineSelect()).toBeDisabled();
    });

    it("sends the chosen engine on the rung it adds", async () => {
      const onChange = await renderAdd();
      fireEvent.change(engineSelect(), { target: { value: "simple-2d" } });
      fireEvent.click(screen.getByRole("button", { name: "+ Add rung" }));
      expect(onChange).toHaveBeenCalledWith([
        {
          slug: "alpha",
          version: "v1.0.0",
          variant: "base",
          engine: "simple-2d",
        },
      ]);
    });

    it("omits the engine entirely for the engineless run", async () => {
      const onChange = await renderAdd();
      fireEvent.click(screen.getByRole("button", { name: "+ Add rung" }));
      expect(onChange).toHaveBeenCalledWith([
        { slug: "alpha", version: "v1.0.0", variant: "base" },
      ]);
    });

    it("lets one climb hold the same case on two engines", async () => {
      const onChange = await renderAdd([
        { slug: "alpha", version: "v1.0.0", variant: "base" },
      ]);
      fireEvent.change(engineSelect(), { target: { value: "simple-2d" } });
      fireEvent.click(screen.getByRole("button", { name: "+ Add rung" }));
      expect(onChange).toHaveBeenCalledWith([
        { slug: "alpha", version: "v1.0.0", variant: "base" },
        {
          slug: "alpha",
          version: "v1.0.0",
          variant: "base",
          engine: "simple-2d",
        },
      ]);
    });

    it("still refuses the same case on the same engine", async () => {
      const onChange = await renderAdd([
        {
          slug: "alpha",
          version: "v1.0.0",
          variant: "base",
          engine: "none",
        },
      ]);
      fireEvent.click(screen.getByRole("button", { name: "+ Add rung" }));
      // Absent and `none` are one pin, so the second add is the rung already there.
      expect(onChange).not.toHaveBeenCalled();
    });

    // `backendValue` resolves no version at all, which is what the editor renders
    // against for the first frames after it opens. A select with no options paints as
    // an empty box beside an Add button that would file a perfectly real rung.
    it("names the engineless run rather than going blank before the version resolves", async () => {
      await renderList([]);
      expect(engineSelect().value).toBe("none");
      expect([...engineSelect().options].map((o) => o.textContent)).toEqual([
        "None",
      ]);
      expect(engineSelect()).toBeDisabled();
    });

    it("names each rung's engine on its row, leaving the engineless one unnamed", async () => {
      await renderAdd([
        { id: "a", slug: "alpha", version: "v1.0.0", variant: "base" },
        {
          id: "b",
          slug: "alpha",
          version: "v1.0.0",
          variant: "base",
          engine: "simple-2d",
        },
      ]);
      // Two rows of one case that read alike are two the reviewer cannot order,
      // reorder, or remove with any confidence.
      expect(screen.getByText("Alpha · base · v1.0.0")).toBeTruthy();
      expect(
        screen.getByText("Alpha · base · v1.0.0 · Simple 2D"),
      ).toBeTruthy();
    });
  });

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

  // Dragging is the reorder a reviewer reaches for, so it is driven here through
  // dnd-kit's keyboard sensor: it is the same drag the pointer starts, and it is the
  // one jsdom can actually deliver. The rows are given real geometry first, because
  // jsdom measures every element as a zero-sized rect at the origin and a sorting
  // list decides where a rung lands by comparing those rectangles.
  function rect(top: number, height: number): DOMRect {
    return {
      x: 0,
      y: top,
      top,
      bottom: top + height,
      left: 0,
      right: 200,
      width: 200,
      height,
      toJSON: () => {},
    } as DOMRect;
  }

  function layOutRows(height = 50) {
    const rows = document.querySelectorAll("li");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => rect(i * height, height);
    });
    // The list too, not just its rows: the drag is confined to its parent, so a
    // zero-sized `<ol>` would pin every rung to the top of a box with no room in it.
    const list = document.querySelector("ol");
    if (list) list.getBoundingClientRect = () => rect(0, rows.length * height);
  }

  // Space lifts the rung, an arrow moves it a place, Space drops it.
  async function dragWithKeyboard(handle: Element, key: string) {
    layOutRows();
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    await act(async () => {});
    fireEvent.keyDown(handle, { key, code: key });
    await act(async () => {});
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    await act(async () => {});
  }

  it("drags a rung down the climb", async () => {
    const onChange = await renderList([
      rung({ id: "a" }),
      rung({ id: "b", slug: "zeta" }),
    ]);
    await dragWithKeyboard(
      screen.getByLabelText(/^Reorder rung 1,/),
      "ArrowDown",
    );
    expect(onChange).toHaveBeenCalledWith([
      rung({ id: "b", slug: "zeta" }),
      rung({ id: "a" }),
    ]);
  });

  it("drags a rung up the climb", async () => {
    const onChange = await renderList([
      rung({ id: "a" }),
      rung({ id: "b", slug: "zeta" }),
      rung({ id: "c", slug: "mu" }),
    ]);
    await dragWithKeyboard(
      screen.getByLabelText(/^Reorder rung 3,/),
      "ArrowUp",
    );
    expect(onChange).toHaveBeenCalledWith([
      rung({ id: "a" }),
      rung({ id: "c", slug: "mu" }),
      rung({ id: "b", slug: "zeta" }),
    ]);
  });

  // A drag that ends where it started is not an edit: reporting one would mark the
  // draft dirty and, on save, rewrite the climb for nothing.
  it("does not report a change when a rung is dropped where it was", async () => {
    const onChange = await renderList([
      rung({ id: "a" }),
      rung({ id: "b", slug: "zeta" }),
    ]);
    const handle = screen.getByLabelText(/^Reorder rung 1,/);
    layOutRows();
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    await act(async () => {});
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
  });

  // The buttons are not decoration left over from before the drag: they are the
  // one-step nudge, and the only reorder available without a pointer or a lift.
  it("keeps a per-rung handle alongside the move buttons", async () => {
    await renderList([rung({ id: "a" }), rung({ id: "b", slug: "zeta" })]);
    expect(screen.getAllByLabelText(/^Reorder rung /)).toHaveLength(2);
    expect(screen.getByLabelText("Move rung 2 up")).toBeTruthy();
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
