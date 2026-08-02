// Saved queries: the handoff from Discover, and the form that stores **text**.
//
// The one property worth pinning is what gets stored. A saved query carries its source
// text and its range *token* — never the compiled query and never absolute milliseconds —
// because that is what makes a relative `now-30d` re-resolve on every run rather than
// freezing the window it was written in. A test that only checked "the row appeared" would
// pass against an implementation that saved the compiled form.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GgSavedQueryInput } from "@test-cabinet/run-record/gg-query";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import { GgSavedQueriesPage } from "./GgSavedQueriesPage";

vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({ PromptHeader: () => null }));
vi.mock("../../../client/auth", () => ({ useAuth: () => ({ token: "t0" }) }));

const listGgSavedQueries = vi.fn();
const createGgSavedQuery = vi.fn();
const updateGgSavedQuery = vi.fn();

function backendValue(): BackendContextValue {
  return {
    client: { listGgSavedQueries, createGgSavedQuery, updateGgSavedQuery },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

/** Reports the current location, so the URL cleanup can be asserted on. */
function Where() {
  const location = useLocation();
  return (
    <output data-testid="where">{`${location.pathname}${location.search}`}</output>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BackendProvider value={backendValue()}>
        <Where />
        <Routes>
          <Route path="/gg/saved" element={<GgSavedQueriesPage />} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

const lastCreate = (): GgSavedQueryInput =>
  createGgSavedQuery.mock.calls[createGgSavedQuery.mock.calls.length - 1]?.[0];

describe("GgSavedQueriesPage", () => {
  beforeEach(() => {
    listGgSavedQueries.mockReset();
    createGgSavedQuery.mockReset();
    updateGgSavedQuery.mockReset();
    listGgSavedQueries.mockResolvedValue([]);
    createGgSavedQuery.mockResolvedValue({});
    updateGgSavedQuery.mockResolvedValue({});
  });

  it("stores the query as source text and the range as a token", async () => {
    renderAt(
      "/gg/saved?new=1&range=30d&q=" +
        encodeURIComponent("started >= now-30d and model:\"anthropic/*\""),
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue(/now-30d/)).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "recent anthropic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new query" }));

    await waitFor(() => expect(createGgSavedQuery).toHaveBeenCalled());
    const saved = lastCreate();
    // Text, verbatim — the relative date survives, which is the whole point.
    expect(saved.query).toBe('started >= now-30d and model:"anthropic/*"');
    // A token, not milliseconds: the range re-resolves too.
    expect(saved.rangeId).toBe("30d");
    expect(saved.name).toBe("recent anthropic");
  });

  it("consumes the Discover handoff parameters so a reload does not reopen the form", async () => {
    renderAt("/gg/saved?new=1&q=" + encodeURIComponent("state:hung"));
    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe("/gg/saved"),
    );
    // The form is still open — only the URL was cleaned.
    expect(screen.getByDisplayValue("state:hung")).toBeInTheDocument();
  });

  it("edits a stored query in place rather than saving a second copy", async () => {
    listGgSavedQueries.mockResolvedValue([
      {
        id: "q1",
        name: "overflow",
        description: "",
        query: "| stats count() by model",
        rangeId: "all",
        updatedAt: "2026-08-01T00:00:00Z",
      },
    ]);
    renderAt("/gg/saved");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save query" }));

    await waitFor(() => expect(updateGgSavedQuery).toHaveBeenCalled());
    expect(updateGgSavedQuery.mock.calls[0]?.[0]).toBe("q1");
    expect(createGgSavedQuery).not.toHaveBeenCalled();
  });

  it("lists only what the account owns, by asking with the account's token", async () => {
    // The corpus is deployment-wide and the view over it is not; the token is an owner
    // filter here, unlike on the query endpoints where it is only a gate.
    renderAt("/gg/saved");
    await waitFor(() => expect(listGgSavedQueries).toHaveBeenCalledWith("t0"));
  });
});
