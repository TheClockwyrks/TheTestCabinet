import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ModelsPage } from "./ModelsPage";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import type { ListPriceRefresh } from "../../../client/types";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import type { ModelSummary } from "../../data/models";
import { RunsRuntimeProvider, useRunsRuntime } from "../../runtime/runsRuntime";

// The Models page's "Refresh" control: one press re-reads every curated
// model's list price from OpenRouter (`POST /models/list-prices/refresh`), the
// catalog is re-read once the backend answers, and the page reports what the
// refresh did. It sits immediately before "+ Add model" and shows exactly where
// that control shows.

vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const authState = vi.hoisted((): { token: string | null } => ({ token: "t" }));
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: authState.token }),
}));

beforeEach(() => {
  authState.token = "t";
});

const MODELS = [
  { slug: "anthropic-claude", name: "Claude", provider: "anthropic" },
] as unknown as ModelSummary[];

const COUNTS: ListPriceRefresh = {
  total: 12,
  updated: 3,
  unchanged: 8,
  unresolved: 1,
};

function galleryValue(canExecute = true): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: () => Promise.resolve({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models: MODELS,
    modelsStatus: "ready",
    canExecute,
  } as unknown as GalleryDataInput;
}

// The whole config surface must be present or `useModelConfig` hides both
// controls, so every method it gates on is stubbed.
function configClient(refreshListPrices: ReturnType<typeof vi.fn>) {
  return {
    createModel: vi.fn(),
    updateModel: vi.fn(),
    deleteModel: vi.fn(),
    fetchModelLogo: vi.fn(),
    seedModelFromRun: vi.fn(),
    lookupOpenrouterModel: vi.fn(),
    refreshListPrices,
  };
}

function backendValue(client: object): BackendContextValue {
  return {
    client,
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: vi.fn(),
  } as unknown as BackendContextValue;
}

// Shows the runtime's refresh token: the nudge every catalog reader re-reads
// on (the console's gallery re-reads `GET /models` when it moves).
function RefreshTokenProbe() {
  const { refreshToken } = useRunsRuntime();
  return <span data-testid="refresh-token">{refreshToken}</span>;
}

function renderPage({
  refreshListPrices = vi.fn().mockResolvedValue(COUNTS),
  client,
  tab,
  canExecute = true,
}: {
  refreshListPrices?: ReturnType<typeof vi.fn>;
  client?: object;
  tab?: "models" | "providers";
  canExecute?: boolean;
} = {}) {
  render(
    <MemoryRouter
      initialEntries={[tab === "providers" ? "/models/providers" : "/models"]}
    >
      <RunsRuntimeProvider>
        <GalleryDataProvider value={galleryValue(canExecute)}>
          <BackendProvider
            value={backendValue(client ?? configClient(refreshListPrices))}
          >
            <ModelsPage tab={tab} />
            <RefreshTokenProbe />
          </BackendProvider>
        </GalleryDataProvider>
      </RunsRuntimeProvider>
    </MemoryRouter>,
  );
}

const refreshButton = () => screen.getByRole("button", { name: "Refresh" });
const queryRefreshButton = () =>
  screen.queryByRole("button", { name: "Refresh" });
const addModel = () => screen.getByRole("link", { name: "+ Add model" });
const queryAddModel = () => screen.queryByRole("link", { name: "+ Add model" });
const refreshToken = () => screen.getByTestId("refresh-token").textContent;

// Every element the page rendered, in document order.
const elementsInOrder = () =>
  screen.getAllByText((_content, element) => element !== null);

// A request the test settles by hand, so the pending state can be observed.
// `resolve` is a mock that takes the promise's resolver as its implementation:
// the project's `lib` (ES2022) has no `Promise.withResolvers`.
function deferred<T>() {
  const resolve = vi.fn<(value: T) => void>();
  const promise = new Promise<T>((settle) => {
    resolve.mockImplementation(settle);
  });
  return { promise, resolve };
}

// Settles a deferred refresh and lets the page take its answer.
async function answer(pending: ReturnType<typeof deferred<ListPriceRefresh>>) {
  await act(async () => {
    pending.resolve(COUNTS);
    await pending.promise;
  });
}

describe("the Models page's Refresh control", () => {
  it("sits immediately before + Add model, as a plain button", () => {
    renderPage();
    const button = refreshButton();
    const add = addModel();
    expect(button).toHaveAttribute("type", "button");
    const elements = elementsInOrder();
    // Adjacent, the refresh first: the element that follows the button and
    // everything inside it is the link.
    const next = elements
      .slice(elements.indexOf(button) + 1)
      .find((element) => !button.contains(element));
    expect(next).toBe(add);
    // The icon leads the label: the button's first element is the svg.
    const icon = elements[elements.indexOf(button) + 1];
    expect(button).toContainElement(icon ?? null);
    expect(icon?.tagName.toLowerCase()).toBe("svg");
    expect(button).toHaveTextContent(/^Refresh$/);
  });

  // Every condition that hides "+ Add model" hides the refresh with it, and
  // nothing else does.
  it.each([
    ["on the Providers tab", { tab: "providers" as const }],
    ["on a host that cannot execute", { canExecute: false }],
    [
      "on a transport without the model mutations",
      { client: { listModels: vi.fn() } },
    ],
  ])("is hidden with + Add model %s", (_name, options) => {
    renderPage(options);
    expect(queryAddModel()).toBeNull();
    expect(queryRefreshButton()).toBeNull();
  });

  it("is hidden with + Add model when signed out", () => {
    authState.token = null;
    renderPage();
    expect(queryAddModel()).toBeNull();
    expect(queryRefreshButton()).toBeNull();
  });

  it("calls the endpoint once with the signed-in token", async () => {
    const refresh = vi.fn().mockResolvedValue(COUNTS);
    renderPage({ refreshListPrices: refresh });
    fireEvent.click(refreshButton());
    await waitFor(() => expect(refreshButton()).toBeEnabled());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("t");
  });

  it("is disabled while the request runs and enabled again after", async () => {
    const pending = deferred<ListPriceRefresh>();
    const refresh = vi.fn().mockReturnValue(pending.promise);
    renderPage({ refreshListPrices: refresh });
    expect(refreshButton()).toBeEnabled();

    fireEvent.click(refreshButton());
    expect(refreshButton()).toBeDisabled();
    expect(refreshButton()).toHaveAttribute("aria-busy", "true");
    // A press on the disabled control starts no second refresh.
    fireEvent.click(refreshButton());
    expect(refresh).toHaveBeenCalledTimes(1);
    // Nothing is reported, and nothing re-read, before the backend answers.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(refreshToken()).toBe("0");

    await answer(pending);
    expect(refreshButton()).toBeEnabled();
    expect(refreshButton()).toHaveAttribute("aria-busy", "false");
  });

  it("re-reads the catalog and reports the counts once the refresh answers", async () => {
    renderPage();
    expect(refreshToken()).toBe("0");
    fireEvent.click(refreshButton());

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(
      /^Refreshed the list price of 12 models: 3 updated, 8 unchanged, 1 with no rate on OpenRouter\.$/,
    );
    expect(refreshToken()).toBe("1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the catalog has no curated model to refresh", async () => {
    renderPage({
      refreshListPrices: vi.fn().mockResolvedValue({
        total: 0,
        updated: 0,
        unchanged: 0,
        unresolved: 0,
      }),
    });
    fireEvent.click(refreshButton());
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/^No models to refresh\.$/);
  });

  it("shows the error of a refresh that failed and re-reads nothing", async () => {
    renderPage({
      refreshListPrices: vi
        .fn()
        .mockRejectedValue(new Error("502: OpenRouter unreachable")),
    });
    fireEvent.click(refreshButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("502: OpenRouter unreachable");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(refreshToken()).toBe("0");
    // The control is usable again, so the operator can retry.
    expect(refreshButton()).toBeEnabled();
  });

  it("clears the last outcome when the next press starts", async () => {
    const pending = deferred<ListPriceRefresh>();
    renderPage({
      refreshListPrices: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockReturnValueOnce(pending.promise),
    });
    fireEvent.click(refreshButton());
    await screen.findByRole("alert");

    fireEvent.click(refreshButton());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await answer(pending);
    expect(screen.getByRole("status")).toHaveTextContent("3 updated");
  });
});
