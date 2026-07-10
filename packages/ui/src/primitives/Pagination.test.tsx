import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Pagination } from "./Pagination";

// The visible page numbers, in order, read off the rendered buttons.
function shownPages(): number[] {
  return screen
    .getAllByRole("button", { name: /^Page \d+$/ })
    .map((button) => Number(button.textContent));
}

describe("Pagination", () => {
  it("renders nothing for a single page", () => {
    const { container } = render(
      <Pagination page={0} pageCount={1} onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("clamps the window to the start on the first page", () => {
    render(
      <Pagination
        page={0}
        pageCount={40}
        maxPages={11}
        onPageChange={() => {}}
      />,
    );
    expect(shownPages()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("centres the current page in the middle of the window", () => {
    render(
      <Pagination
        page={14}
        pageCount={40}
        maxPages={11}
        onPageChange={() => {}}
      />,
    );
    // Page 15 (index 14) sits dead-centre of an 11-wide window: 10–20.
    expect(shownPages()).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(screen.getByRole("button", { name: "Page 15" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("clamps the window to the end on the last page", () => {
    render(
      <Pagination
        page={19}
        pageCount={20}
        maxPages={11}
        onPageChange={() => {}}
      />,
    );
    expect(shownPages()).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("never shows more buttons than there are pages", () => {
    render(
      <Pagination
        page={0}
        pageCount={4}
        maxPages={11}
        onPageChange={() => {}}
      />,
    );
    expect(shownPages()).toEqual([1, 2, 3, 4]);
  });

  it("reports the clicked page and clamps prev/next at the boundaries", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <Pagination page={0} pageCount={20} onPageChange={onPageChange} />,
    );

    // Prev is inert on the first page; Next steps forward.
    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);

    // A numbered button jumps straight to that page.
    fireEvent.click(screen.getByRole("button", { name: "Page 5" }));
    expect(onPageChange).toHaveBeenLastCalledWith(4);

    // Next is inert on the last page.
    rerender(
      <Pagination page={19} pageCount={20} onPageChange={onPageChange} />,
    );
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });
});
