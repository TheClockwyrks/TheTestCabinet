import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { CoverageGroup } from "@test-cabinet/run-record/coverage";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import { GroupsPage } from "./GroupsPage";

// The page's app chrome reads contexts none of these tests are about; stub it as the
// other account page tests do.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  PromptHeader: ({ titleActions }: { titleActions?: ReactNode }) => (
    <>{titleActions}</>
  ),
}));
vi.mock("../../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: async () => true, alert: async () => {} }),
}));
// A group belongs to an account, so a token is what makes the list exist at all.
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));

function renderPage(groups: CoverageGroup[]) {
  const value = {
    client: { listCoverageGroups: vi.fn().mockResolvedValue(groups) },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
  render(
    <MemoryRouter>
      <BackendProvider value={value}>
        <GroupsPage />
      </BackendProvider>
    </MemoryRouter>,
  );
}

const CASE_GROUP = {
  id: "g1",
  kind: "case",
  name: "v0.7 cases",
  cases: [],
} as unknown as CoverageGroup;

// A `kind = "combo"` group holds combinations, and a combination takes two shapes — a
// harness with its model, or a gg configuration with the models it binds. The screen
// that leads into the member picker has to say so, or an operator arriving to schedule
// gg runs is told this list holds harness/model pairs and nothing else.
describe("GroupsPage", () => {
  it("names the combo lists combinations rather than models", async () => {
    renderPage([CASE_GROUP]);
    expect(await screen.findByText("Combination groups")).toBeTruthy();
    expect(screen.getByText("No combination groups yet.")).toBeTruthy();
    expect(screen.queryByText(/model group/i)).toBeNull();
  });

  it("says what a combination is on the empty state", async () => {
    renderPage([]);
    await waitFor(() =>
      expect(screen.getByText(/combination group/)).toBeTruthy(),
    );
    expect(screen.getByText(/gg configurations/)).toBeTruthy();
    expect(screen.queryByText(/harness\/model/)).toBeNull();
  });
});
