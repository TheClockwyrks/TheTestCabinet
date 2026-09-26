import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SubmitNotice } from "./SubmitNotice";

// The console's forms are taller than a viewport, so a submit outcome is only
// useful if it both sits beside the button that raised it and pulls itself onto
// the screen. These cover the second half — the placement is asserted by each
// form's own suite.

describe("SubmitNotice", () => {
  it("renders nothing without a message, so a call site drops it in unconditionally", () => {
    const { container } = render(<SubmitNotice message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces a failure as an alert", () => {
    render(<SubmitNotice message="slug already taken" />);
    expect(screen.getByRole("alert").textContent).toBe("slug already taken");
  });

  it("announces progress and success as a status, not an alert", () => {
    render(<SubmitNotice message="Published." tone="ok" />);
    expect(screen.getByRole("status").textContent).toBe("Published.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("scrolls itself into view when a message appears", () => {
    const scrollIntoView = vi.fn();
    // jsdom implements no layout and so defines no `scrollIntoView` at all.
    Element.prototype.scrollIntoView = scrollIntoView;

    const { rerender } = render(<SubmitNotice message={null} />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(<SubmitNotice message="nope" />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    // An action that reports itself progressively rewrites its message on every
    // line it streams. Revealing each rewrite would drag a reader who had scrolled
    // away back to the notice over and over, so an already-visible notice stays put.
    rerender(<SubmitNotice message="Publishing… uploading" tone="ok" />);
    rerender(<SubmitNotice message="Publishing… indexing" tone="ok" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // Clearing arms it again: the next press is a new outcome to be seen.
    rerender(<SubmitNotice message={null} />);
    rerender(<SubmitNotice message="nope again" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    // @ts-expect-error — restore jsdom's own (absent) implementation.
    delete Element.prototype.scrollIntoView;
  });

  it("survives a host with no scrollIntoView at all", () => {
    expect(Element.prototype.scrollIntoView).toBeUndefined();
    render(<SubmitNotice message="nope" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
