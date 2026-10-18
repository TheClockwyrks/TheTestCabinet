import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

const OPTIONS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "agents", label: "Agents" },
  { value: "instances", label: "Instances" },
] as const;

/** Give the scroller a layout jsdom does not compute: a 100px window onto a 300px
 * track of three 100px segments. */
function layOut(scroller: HTMLElement, scrollLeft = 0) {
  Object.defineProperty(scroller, "clientWidth", { value: 100 });
  Object.defineProperty(scroller, "scrollWidth", { value: 300 });
  scroller.scrollLeft = scrollLeft;
  scroller.querySelectorAll<HTMLElement>("[role=radio]").forEach((el, i) => {
    Object.defineProperty(el, "offsetLeft", { value: i * 100 });
    Object.defineProperty(el, "offsetWidth", { value: 100 });
  });
}

describe("SegmentedControl", () => {
  it("is a radio group whose segments select their value", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={OPTIONS}
        value="dashboard"
        onChange={onChange}
        ariaLabel="gg panel"
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "gg panel" });
    expect(screen.getByRole("radio", { name: "Dashboard" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Agents" }));
    expect(onChange).toHaveBeenCalledWith("agents");
    // The track sits in a scroller of its own, so a track wider than its space
    // scrolls rather than compressing its segments.
    expect(group.parentElement).not.toBeNull();
    expect(group.parentElement).not.toHaveAttribute("role");
  });

  it("scrolls a selection made off-screen into view", () => {
    const { rerender } = render(
      <SegmentedControl
        options={OPTIONS}
        value="dashboard"
        onChange={() => {}}
      />,
    );
    const scroller = screen.getByRole("radiogroup").parentElement!;
    layOut(scroller);
    rerender(
      <SegmentedControl
        options={OPTIONS}
        value="instances"
        onChange={() => {}}
      />,
    );
    expect(scroller.scrollLeft).toBe(200);
    // Fading the start edge says there are segments back the other way.
    fireEvent.scroll(scroller);
    expect(scroller).toHaveAttribute("data-overflow-start");
    expect(scroller).not.toHaveAttribute("data-overflow-end");
  });

  it("fades the end edge while segments lie past it", () => {
    render(
      <SegmentedControl
        options={OPTIONS}
        value="dashboard"
        onChange={() => {}}
      />,
    );
    const scroller = screen.getByRole("radiogroup").parentElement!;
    layOut(scroller);
    fireEvent.scroll(scroller);
    expect(scroller).toHaveAttribute("data-overflow-end");
    expect(scroller).not.toHaveAttribute("data-overflow-start");
  });
});
