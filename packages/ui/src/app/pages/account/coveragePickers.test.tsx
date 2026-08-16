import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AxisPicker, BufferTargetField, axisLabel } from "./coveragePickers";

// The ordering control names what a reviewer will be able to compare, never how the
// loop is nested — "depth first" / "breadth first" answer none of their question and
// must not reach the console.
describe("AxisPicker", () => {
  it("labels the axes the way the console names them everywhere", () => {
    expect(axisLabel("case")).toBe("One case at a time");
    expect(axisLabel("combination")).toBe("One model at a time");
  });

  it("marks the current axis and reports the other when picked", () => {
    const onChange = vi.fn();
    render(<AxisPicker value="case" onChange={onChange} />);
    const options = screen.getAllByRole("radio");
    expect(options.map((o) => o.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ]);
    fireEvent.click(screen.getByText("One model at a time"));
    expect(onChange).toHaveBeenCalledWith("combination");
  });

  it("never describes the choice as a traversal", () => {
    const { container } = render(
      <AxisPicker value="case" onChange={vi.fn()} />,
    );
    expect(container.textContent).not.toMatch(/depth|breadth/i);
  });
});

// Empty and `0` are different instructions — "use my account default" versus "never
// top this plan up" — so the field must never collapse one into the other.
describe("BufferTargetField", () => {
  function renderField(value: number | null, onChange = vi.fn()) {
    render(
      <BufferTargetField
        value={value}
        accountDefault={7}
        onChange={onChange}
      />,
    );
    return {
      onChange,
      input: screen.getByRole("spinbutton") as HTMLInputElement,
    };
  }

  it("shows the inherited account default as the placeholder when unset", () => {
    const { input } = renderField(null);
    expect(input.value).toBe("");
    expect(input.getAttribute("placeholder")).toBe("7");
    expect(screen.getByText(/inherits your account default of 7/)).toBeTruthy();
  });

  it("reports an emptied field as null, not as zero", () => {
    const { onChange, input } = renderField(3);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("keeps zero as a real instruction rather than as 'unset'", () => {
    const { onChange, input } = renderField(3);
    fireEvent.change(input, { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("spells out what zero means, since it looks like an empty field", () => {
    renderField(0);
    expect(screen.getByText(/stops this plan topping itself up/i)).toBeTruthy();
    expect(screen.getByText(/different from empty/i)).toBeTruthy();
  });

  it("offers dropping the override without deleting digits", () => {
    const { onChange } = renderField(4);
    fireEvent.click(screen.getByRole("button", { name: "Use my default" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
