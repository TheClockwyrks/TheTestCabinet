import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageErrorBoundary } from "./PageErrorBoundary";

// The boundary renders the app's chrome around its message, and the chrome reads
// contexts that say nothing about containment. Stub it down to its children so
// these tests are about the boundary alone.
vi.mock("./PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => (
    <div>
      <nav>Section nav</nav>
      {children}
    </div>
  ),
}));

function Boom(): never {
  throw new Error("the page exploded");
}

function Fine() {
  return <p>the page rendered</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PageErrorBoundary>
        <Routes>
          <Route path="/" element={<Fine />} />
          <Route path="/boom" element={<Boom />} />
          <Route path="/fine" element={<Fine />} />
        </Routes>
      </PageErrorBoundary>
    </MemoryRouter>,
  );
}

describe("PageErrorBoundary", () => {
  // React reports every caught error through console.error too; silence it so a
  // deliberate throw doesn't print a page of stack on a passing run.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes a page that renders through untouched", () => {
    renderAt("/fine");
    expect(screen.getByText("the page rendered")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("contains a throwing page instead of blanking the app", () => {
    renderAt("/boom");
    // The whole point: the app is still on screen. Before this existed, a page
    // that threw unmounted the entire tree — no chrome, no nav, nothing but a
    // white screen and a console message the visitor never sees.
    expect(screen.getByText("Section nav")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This page hit an error",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("the page exploded");
  });

  it("reports the failure to the console rather than swallowing it", () => {
    renderAt("/boom");
    // Survivable must not mean silent: this is what still gets the bug fixed.
    expect(console.error).toHaveBeenCalledWith(
      "Page failed to render:",
      expect.objectContaining({ message: "the page exploded" }),
      expect.anything(),
    );
  });

  it("recovers when the visitor navigates away from the broken page", async () => {
    renderAt("/boom");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // A new path is a fresh attempt. Without the reset the boundary would hold
    // its message over every subsequent page, turning one broken route into a
    // broken session — so the way out it offers has to actually work.
    fireEvent.click(screen.getByRole("link", { name: "Go home" }));

    expect(await screen.findByText("the page rendered")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
