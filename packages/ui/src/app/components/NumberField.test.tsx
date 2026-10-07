import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  NumberField,
  NumberValueField,
  useNumberFieldState,
} from "./NumberField";

// A form of one required numeric field with a submit that refuses on it — the shape
// every owning page takes.
function CountForm({ onSubmit }: { onSubmit: (runs: number) => void }) {
  const runs = useNumberFieldState(1, {
    label: "Run count",
    min: 1,
    max: 20,
    integer: true,
  });
  return (
    <>
      {/* Labelled the way a page labels it: a separate <label> claiming the
          control's id, so the problem sentence is beside the field rather than
          swallowed into the label's own text. */}
      <label htmlFor="runs">Run count</label>
      <NumberField
        id="runs"
        {...runs.bounds}
        value={runs.raw}
        onChange={runs.setRaw}
      />
      <button
        type="button"
        disabled={!runs.valid}
        onClick={() => runs.value !== undefined && onSubmit(runs.value)}
      >
        Launch
      </button>
    </>
  );
}

const field = () => screen.getByLabelText("Run count");

describe("NumberField", () => {
  // The report this was built for: "1" could not be replaced by "5" without
  // selecting it or driving the spinner, because clearing it snapped back to 1.
  it("stays empty when the operator clears it", () => {
    render(<CountForm onSubmit={() => {}} />);
    fireEvent.change(field(), { target: { value: "" } });
    expect(field()).toHaveValue(null);
    // …and the next keystroke is the whole value, not a digit appended to a floor.
    fireEvent.change(field(), { target: { value: "5" } });
    expect(field()).toHaveValue(5);
  });

  it("refuses to submit while the field is empty, and says why", () => {
    const onSubmit = vi.fn();
    render(<CountForm onSubmit={onSubmit} />);
    fireEvent.change(field(), { target: { value: "" } });

    expect(screen.getByRole("button", { name: "Launch" })).toBeDisabled();
    expect(screen.getByText("Run count is required.")).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses to submit an out-of-range entry, and says which way", () => {
    const onSubmit = vi.fn();
    render(<CountForm onSubmit={onSubmit} />);

    fireEvent.change(field(), { target: { value: "40" } });
    expect(screen.getByText("Run count must be 20 or less.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Launch" })).toBeDisabled();

    fireEvent.change(field(), { target: { value: "0" } });
    expect(screen.getByText("Run count must be 1 or more.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the value once the field names one", () => {
    const onSubmit = vi.fn();
    render(<CountForm onSubmit={onSubmit} />);
    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.change(field(), { target: { value: "7" } });

    expect(screen.queryByText(/Run count must|is required/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    expect(onSubmit).toHaveBeenCalledWith(7);
  });

  it("ties the problem to the field for a screen reader", () => {
    render(<CountForm onSubmit={() => {}} />);
    fireEvent.change(field(), { target: { value: "" } });
    const describedBy = field().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "Run count is required.",
    );
  });

  it("does not report a disabled field as wrong", () => {
    render(
      <NumberField
        ariaLabel="Buffer"
        label="The buffer"
        min={0}
        value=""
        disabled
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Buffer")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("The buffer is required.")).toBeNull();
  });
});

// The live-value variant: the grid size in the Lattice designer, a gate's threshold,
// an agent's opening-tree depth — values held as numbers, where an in-progress edit
// must change nothing.
function GridWidth({ onResize }: { onResize: (w: number) => void }) {
  const [width, setWidth] = useState(30);
  return (
    <>
      <NumberValueField
        ariaLabel="Width"
        label="The board’s width"
        min={4}
        max={120}
        integer
        value={width}
        onCommit={(next) => {
          setWidth(next);
          onResize(next);
        }}
      />
      <output>{width}</output>
    </>
  );
}

describe("NumberValueField", () => {
  it("commits nothing while the field is empty", () => {
    const onResize = vi.fn();
    render(<GridWidth onResize={onResize} />);
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "" } });

    expect(screen.getByLabelText("Width")).toHaveValue(null);
    expect(screen.getByRole("status")).toHaveTextContent("30");
    expect(onResize).not.toHaveBeenCalled();
  });

  // Typing "12" one digit at a time passes through "1", which is below the floor.
  // The old field clamped that to the floor and resized the design to it.
  it("commits nothing while the typing is below the floor", () => {
    const onResize = vi.fn();
    render(<GridWidth onResize={onResize} />);
    fireEvent.change(screen.getByLabelText("Width"), {
      target: { value: "1" },
    });

    expect(screen.getByLabelText("Width")).toHaveValue(1);
    expect(screen.getByRole("status")).toHaveTextContent("30");
    expect(onResize).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Width"), {
      target: { value: "12" },
    });
    expect(onResize).toHaveBeenCalledExactlyOnceWith(12);
  });

  it("restores the committed value when an unusable field is left", () => {
    render(<GridWidth onResize={() => {}} />);
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "" } });
    fireEvent.blur(screen.getByLabelText("Width"));
    expect(screen.getByLabelText("Width")).toHaveValue(30);
  });

  it("follows the value when something else moves it mid-edit", () => {
    function Preset() {
      const [width, setWidth] = useState(30);
      return (
        <>
          <NumberValueField
            ariaLabel="Width"
            min={4}
            max={120}
            integer
            value={width}
            onCommit={setWidth}
          />
          <button type="button" onClick={() => setWidth(64)}>
            Preset
          </button>
        </>
      );
    }
    render(<Preset />);
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Preset" }));
    expect(screen.getByLabelText("Width")).toHaveValue(64);
  });

  // A parent that has not echoed the commit back — or that declines it outright —
  // must not yank the text out from under the caret.
  it("keeps the typing when the value behind it does not move", () => {
    render(
      <NumberValueField
        ariaLabel="Bound"
        label="The bound"
        min={0}
        max={500}
        integer
        value={3}
        onCommit={() => {}}
      />,
    );
    const input = screen.getByLabelText("Bound");
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue(null);
    fireEvent.change(input, { target: { value: "9999" } });
    expect(input).toHaveValue(9999);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  // …but a reset that happens to restore the figure standing before the edit is
  // still somebody else's change, and takes the field with it.
  it("follows a reset back to the value the edit started from", () => {
    function Resettable() {
      const [depth, setDepth] = useState(2);
      return (
        <>
          <NumberValueField
            ariaLabel="Depth"
            min={1}
            max={10}
            integer
            value={depth}
            onCommit={setDepth}
          />
          <button type="button" onClick={() => setDepth(2)}>
            Reset
          </button>
        </>
      );
    }
    render(<Resettable />);
    fireEvent.change(screen.getByLabelText("Depth"), {
      target: { value: "4" },
    });
    expect(screen.getByLabelText("Depth")).toHaveValue(4);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Depth")).toHaveValue(2);
  });

  // An optional field's empty state is an answer, so it has to reach the record
  // rather than being held as an unfinished edit.
  it("clears an optional field's value when it is emptied", () => {
    function Override() {
      const [runs, setRuns] = useState<number | undefined>(5);
      return (
        <>
          <NumberValueField
            ariaLabel="Override"
            optional
            min={1}
            max={100}
            integer
            value={runs}
            onCommit={setRuns}
            onClear={() => setRuns(undefined)}
          />
          <output>{runs === undefined ? "inherited" : runs}</output>
        </>
      );
    }
    render(<Override />);
    fireEvent.change(screen.getByLabelText("Override"), {
      target: { value: "" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("inherited");
    expect(screen.getByLabelText("Override")).toHaveValue(null);
  });
});
