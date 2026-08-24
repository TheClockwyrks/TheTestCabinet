// The boards list: what is built in, what is the account's, and what "Duplicate" means.
//
// Three properties are worth pinning, and each one has a failure mode that would ship
// looking fine:
//
// - **The built-in overview needs nothing stored.** It is defined as query text in code,
//   so it must list — and be openable — on a deployment where the account has saved
//   nothing and on one where the caller is not signed in at all.
// - **Duplicating it produces a *create*, and leaves the built-in untouched.** The
//   overview is a module singleton shared with the view page, so an editor that ever
//   wrote through to a draft's panels — as any in-place rewrite of this form would —
//   rewrites the built-in board for the rest of the session, and nothing on screen says
//   so. The invariant is pinned here rather than left to the copy being deep today.
// - **The account's boards are asked for with the account's token.** The corpus is
//   deployment-wide and the view over it is not; here the token is an owner filter, not
//   merely a gate.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GgDashboardInput } from "@test-cabinet/run-record/gg-query";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import { GgDashboardsPage } from "./GgDashboardsPage";
import { OVERVIEW_DASHBOARD } from "./dashboards/overviewDashboard";

vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  // The header's chrome is not what these tests are about; its slots are, because a
  // page's own actions live in them. Stub the chrome and pass the slots through, so a
  // control that moves into the header does not silently vanish from the test.
  PromptHeader: ({
    titleActions,
    actions,
  }: {
    titleActions?: ReactNode;
    actions?: ReactNode;
  }) => (
    <>
      {titleActions}
      {actions}
    </>
  ),
}));
vi.mock("../../../client/auth", () => ({ useAuth: () => ({ token: "t0" }) }));

const listGgDashboards = vi.fn();
const createGgDashboard = vi.fn();
const updateGgDashboard = vi.fn();

function backendValue(): BackendContextValue {
  return {
    client: { listGgDashboards, createGgDashboard, updateGgDashboard },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/gg/dashboards"]}>
      <BackendProvider value={backendValue()}>
        <Routes>
          <Route path="/gg/dashboards" element={<GgDashboardsPage />} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

const lastCreate = (): GgDashboardInput =>
  createGgDashboard.mock.calls[createGgDashboard.mock.calls.length - 1]?.[0];

/** A stored board, so the "your dashboards" half has something in it. */
const STORED = {
  id: "d1",
  name: "compaction comparison",
  description: "",
  rangeId: "90d",
  updatedAt: "2026-08-01T00:00:00Z",
  panels: [
    { title: "By preset", query: "| stats count() by preset", width: 6 },
  ],
};

describe("GgDashboardsPage", () => {
  beforeEach(() => {
    listGgDashboards.mockReset();
    createGgDashboard.mockReset();
    updateGgDashboard.mockReset();
    listGgDashboards.mockResolvedValue([]);
    createGgDashboard.mockResolvedValue(STORED);
    updateGgDashboard.mockResolvedValue(STORED);
  });

  it("lists the built-in overview with a link to it, storing nothing", async () => {
    renderPage();
    await waitFor(() => expect(listGgDashboards).toHaveBeenCalledWith("t0"));
    expect(
      screen.getByRole("link", { name: OVERVIEW_DASHBOARD.name }),
    ).toHaveAttribute("href", "/gg/dashboards/overview");
  });

  it("duplicates the built-in as a new board, not an edit of it", async () => {
    renderPage();
    await waitFor(() => expect(listGgDashboards).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    // A copy is a create: the built-in has no row to update, and the label says so.
    const create = screen.getByRole("button", { name: "Create dashboard" });
    expect(
      screen.getByDisplayValue(`${OVERVIEW_DASHBOARD.name} (copy)`),
    ).toBeInTheDocument();
    fireEvent.click(create);

    await waitFor(() => expect(createGgDashboard).toHaveBeenCalled());
    expect(updateGgDashboard).not.toHaveBeenCalled();
    const saved = lastCreate();
    // Every panel came across, as **text**, in render order.
    expect(saved.panels).toHaveLength(OVERVIEW_DASHBOARD.panels.length);
    expect(saved.panels.map((p) => p.query)).toEqual(
      OVERVIEW_DASHBOARD.panels.map((p) => p.query),
    );
    // The board's one range came with it — a board carries a range, a panel never does.
    expect(saved.rangeId).toBe(OVERVIEW_DASHBOARD.rangeId);
  });

  it("edits the duplicate without mutating the built-in board", async () => {
    // The overview is a module singleton shared by this page and the view page. Any
    // edit that wrote through to it would rewrite it for the rest of the session.
    const originalTitle = OVERVIEW_DASHBOARD.panels[0]!.title;
    renderPage();
    await waitFor(() => expect(listGgDashboards).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    fireEvent.change(screen.getByLabelText("Panel 1 title"), {
      target: { value: "Renamed in the copy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create dashboard" }));

    await waitFor(() => expect(createGgDashboard).toHaveBeenCalled());
    expect(lastCreate().panels[0]?.title).toBe("Renamed in the copy");
    expect(OVERVIEW_DASHBOARD.panels[0]!.title).toBe(originalTitle);
  });

  it("edits a stored board in place rather than saving a second copy", async () => {
    listGgDashboards.mockResolvedValue([STORED]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save dashboard" }));

    await waitFor(() => expect(updateGgDashboard).toHaveBeenCalled());
    expect(updateGgDashboard.mock.calls[0]?.[0]).toBe("d1");
    expect(createGgDashboard).not.toHaveBeenCalled();
  });

  it("adds and removes panels from the board being edited", async () => {
    renderPage();
    await waitFor(() => expect(listGgDashboards).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "+ New dashboard" }));

    // A new board opens with one panel, because a board with none teaches nobody what a
    // panel is.
    expect(screen.getByLabelText("Panel 1 title")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add panel" }));
    fireEvent.change(screen.getByLabelText("Panel 2 query"), {
      target: { value: "| stats count() by model" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "from scratch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create dashboard" }));

    await waitFor(() => expect(createGgDashboard).toHaveBeenCalled());
    const saved = lastCreate();
    expect(saved.panels).toHaveLength(1);
    expect(saved.panels[0]?.query).toBe("| stats count() by model");
  });
});
