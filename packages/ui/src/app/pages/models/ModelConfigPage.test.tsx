import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import { ModelConfigPage } from "./ModelConfigPage";

// The form's "Fill from OpenRouter" control: an operator types the slug that
// already prices the model and the curated fields fill themselves in, instead of
// being retyped from OpenRouter's own catalog page.

// The page's app chrome reads contexts (backdrop settings, prompt header) that
// are irrelevant to the form logic under test.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t" }),
}));

const LISTING = {
  name: "Claude Sonnet 4.5",
  provider: "Anthropic",
  description: "A model for agents and coding workflows.",
  // The official endpoint's current per-Mtok rates, which the fill seeds the
  // list-price fields from.
  inputPerMtok: 3,
  cachedInputPerMtok: 0.3,
  outputPerMtok: 15,
};

// A listing whose endpoint publishes no rates at all: the fill leaves the
// list-price block to the operator.
const UNPRICED_LISTING = {
  ...LISTING,
  inputPerMtok: null,
  cachedInputPerMtok: null,
  outputPerMtok: null,
};

function galleryValue(modelsStatus = "ready"): GalleryDataInput {
  return {
    models: [],
    modelsStatus,
    canExecute: true,
  } as unknown as GalleryDataInput;
}

function backendValue(
  lookupOpenrouterModel: ReturnType<typeof vi.fn>,
  createModel: ReturnType<typeof vi.fn> = vi.fn(),
): BackendContextValue {
  return {
    client: {
      // The whole config surface must be present or `useModelConfig` hides the
      // form outright, so every method it gates on is stubbed here.
      createModel,
      updateModel: vi.fn(),
      deleteModel: vi.fn(),
      fetchModelLogo: vi.fn(),
      seedModelFromRun: vi.fn(),
      lookupOpenrouterModel,
    },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

function renderPage(
  lookupOpenrouterModel = vi.fn().mockResolvedValue(LISTING),
  createModel = vi.fn().mockResolvedValue({ slug: "claude-sonnet-4-5" }),
) {
  render(
    <MemoryRouter initialEntries={["/models/new"]}>
      <GalleryDataProvider value={galleryValue()}>
        <BackendProvider
          value={backendValue(lookupOpenrouterModel, createModel)}
        >
          <Routes>
            <Route path="/models/new" element={<ModelConfigPage />} />
          </Routes>
        </BackendProvider>
      </GalleryDataProvider>
    </MemoryRouter>,
  );
  return lookupOpenrouterModel;
}

/** Let the fill's async lookup settle, so no state update lands after the
 *  assertions (React logs an act() warning for one that does). */
async function settle() {
  await act(async () => {});
}

const slugInput = () => screen.getByLabelText("OpenRouter slug");
const nameInput = () => screen.getByPlaceholderText("e.g. Claude Opus 4.8");
const providerInput = () => screen.getByPlaceholderText("e.g. Anthropic");
const descriptionInput = () =>
  screen.getByPlaceholderText("What the model is, when to reach for it…");
const inputPriceInput = () => screen.getByLabelText("Input / Mtok");
const cachedPriceInput = () => screen.getByLabelText("Cached input / Mtok");
const outputPriceInput = () => screen.getByLabelText("Output / Mtok");
const asOfInput = () => screen.getByLabelText("Prices taken on");
const fillButton = () => screen.getByRole("button", { name: /fill/i });

function typeSlug(slug: string) {
  fireEvent.change(slugInput(), { target: { value: slug } });
}

describe("ModelConfigPage's OpenRouter fill-in", () => {
  it("fills the name, provider, and description from the slug", async () => {
    const lookup = renderPage();
    typeSlug("anthropic/claude-sonnet-4.5");
    fireEvent.click(fillButton());

    await waitFor(() => expect(nameInput()).toHaveValue("Claude Sonnet 4.5"));
    expect(lookup).toHaveBeenCalledWith("anthropic/claude-sonnet-4.5", "t");
    expect(providerInput()).toHaveValue("Anthropic");
    expect(descriptionInput()).toHaveValue(LISTING.description);
  });

  it("keeps the description when OpenRouter publishes none", async () => {
    renderPage(vi.fn().mockResolvedValue({ ...LISTING, description: null }));
    fireEvent.change(descriptionInput(), { target: { value: "Mine." } });
    typeSlug("anthropic/claude-sonnet-4.5");
    fireEvent.click(fillButton());

    await waitFor(() => expect(nameInput()).toHaveValue("Claude Sonnet 4.5"));
    // A model with no blurb on OpenRouter has nothing to replace the field with,
    // so blanking it would be a deletion the press never asked for.
    expect(descriptionInput()).toHaveValue("Mine.");
  });

  it("claims the untouched alias row for the slug it just filled from", async () => {
    renderPage();
    typeSlug("anthropic/claude-sonnet-4.5");
    fireEvent.click(fillButton());

    // The slug is itself a canonical OpenRouter-family id, so the operator does
    // not retype it into the id list they left blank.
    await waitFor(() =>
      expect(screen.getByLabelText("Model id 1")).toHaveValue(
        "anthropic/claude-sonnet-4.5",
      ),
    );
  });

  it("leaves ids the operator already entered alone", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Model id 1"), {
      target: { value: "claude-sonnet-4-5" },
    });
    typeSlug("anthropic/claude-sonnet-4.5");
    fireEvent.click(fillButton());

    await waitFor(() => expect(nameInput()).toHaveValue("Claude Sonnet 4.5"));
    // That id may be a native slug the operator tagged deliberately; a fill that
    // replaced it would silently undo their choice.
    expect(screen.getByLabelText("Model id 1")).toHaveValue(
      "claude-sonnet-4-5",
    );
  });

  it("trims the slug before looking it up", async () => {
    const lookup = renderPage();
    typeSlug("  anthropic/claude-sonnet-4.5  ");
    fireEvent.click(fillButton());

    await settle();
    expect(lookup).toHaveBeenCalledWith("anthropic/claude-sonnet-4.5", "t");
  });

  it("reports a slug OpenRouter does not list and changes nothing", async () => {
    renderPage(vi.fn().mockRejectedValue(new Error("not found")));
    fireEvent.change(nameInput(), { target: { value: "Hand-written" } });
    typeSlug("nobody/no-such-model");
    fireEvent.click(fillButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("not found");
    expect(nameInput()).toHaveValue("Hand-written");
  });

  it("cannot be pressed without a slug to look up", async () => {
    renderPage();
    expect(fillButton()).toBeDisabled();
    // Whitespace is not a slug.
    typeSlug("   ");
    expect(fillButton()).toBeDisabled();

    typeSlug("anthropic/claude-sonnet-4.5");
    expect(fillButton()).not.toBeDisabled();
    await settle();
  });

  it("seeds the list-price fields from the listing's official endpoint", async () => {
    renderPage();
    typeSlug("anthropic/claude-sonnet-4.5");
    fireEvent.click(fillButton());

    await waitFor(() => expect(inputPriceInput()).toHaveValue("3"));
    expect(cachedPriceInput()).toHaveValue("0.3");
    expect(outputPriceInput()).toHaveValue("15");
    // The figures were just read off the live listing, so the taken-on date is
    // today (UTC) unless the operator already dated them.
    expect(asOfInput()).toHaveValue(new Date().toISOString().slice(0, 10));
  });

  it("seeds the list-price fields without floating-point noise", async () => {
    // Per-token rates scaled to per Mtok come back as 0.12099999999999998.
    renderPage(
      vi.fn().mockResolvedValue({
        ...LISTING,
        inputPerMtok: 0.12099999999999998,
        cachedInputPerMtok: 0.061000000000000006,
        outputPerMtok: 0.24199999999999997,
      }),
    );
    typeSlug("anthropic/claude-sonnet-4.5");
    fireEvent.click(fillButton());

    await waitFor(() => expect(inputPriceInput()).toHaveValue("0.121"));
    expect(cachedPriceInput()).toHaveValue("0.061");
    expect(outputPriceInput()).toHaveValue("0.242");
  });

  it("keeps the entered taken-on date when the fill seeds the prices", async () => {
    renderPage();
    fireEvent.change(asOfInput(), { target: { value: "2026-07-01" } });
    typeSlug("anthropic/claude-sonnet-4.5");
    fireEvent.click(fillButton());

    await waitFor(() => expect(inputPriceInput()).toHaveValue("3"));
    // An entered date records when *those* figures were taken; re-dating them
    // to today would assert something the press does not know.
    expect(asOfInput()).toHaveValue("2026-07-01");
  });

  it("leaves the list-price block blank when the endpoint lists no rates", async () => {
    renderPage(vi.fn().mockResolvedValue(UNPRICED_LISTING));
    typeSlug("anthropic/claude-sonnet-4.5");
    fireEvent.click(fillButton());

    await waitFor(() => expect(nameInput()).toHaveValue("Claude Sonnet 4.5"));
    // An unlisted figure seeds nothing: the operator enters the developer's
    // pricing page's figures by hand.
    expect(inputPriceInput()).toHaveValue("");
    expect(cachedPriceInput()).toHaveValue("");
    expect(outputPriceInput()).toHaveValue("");
    expect(asOfInput()).toHaveValue("");
  });
});

describe("ModelConfigPage's list-price validation", () => {
  const saveButton = () => screen.getByRole("button", { name: "Create model" });

  function enterName() {
    fireEvent.change(nameInput(), { target: { value: "Claude Sonnet 4.5" } });
  }

  it("submits a full price set as per-Mtok figures with the taken-on date", async () => {
    const create = vi.fn().mockResolvedValue({ slug: "claude-sonnet-4-5" });
    renderPage(vi.fn(), create);
    enterName();
    fireEvent.change(inputPriceInput(), { target: { value: "3" } });
    fireEvent.change(cachedPriceInput(), { target: { value: "0.3" } });
    fireEvent.change(outputPriceInput(), { target: { value: "15" } });
    fireEvent.change(asOfInput(), { target: { value: "2026-08-01" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const body = create.mock.calls[0]![0];
    expect(body.listPriceInputPerMtok).toBe(3);
    expect(body.listPriceCachedInputPerMtok).toBe(0.3);
    expect(body.listPriceOutputPerMtok).toBe(15);
    expect(body.listPriceAsOf).toBe("2026-08-01");
  });

  it("blocks a partial price set before any request", async () => {
    const create = vi.fn();
    renderPage(vi.fn(), create);
    enterName();
    fireEvent.change(inputPriceInput(), { target: { value: "3" } });
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /set all three list prices, or none/i,
    );
    expect(create).not.toHaveBeenCalled();
    // The button is not busy-locked: fix the fields and save again.
    expect(saveButton()).not.toBeDisabled();
  });

  it("blocks an undated price set before any request", async () => {
    const create = vi.fn();
    renderPage(vi.fn(), create);
    enterName();
    fireEvent.change(inputPriceInput(), { target: { value: "3" } });
    fireEvent.change(cachedPriceInput(), { target: { value: "0.3" } });
    fireEvent.change(outputPriceInput(), { target: { value: "15" } });
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /date the list prices were taken/i,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("blocks a negative figure with the field named", async () => {
    const create = vi.fn();
    renderPage(vi.fn(), create);
    enterName();
    fireEvent.change(inputPriceInput(), { target: { value: "3" } });
    fireEvent.change(cachedPriceInput(), { target: { value: "-1" } });
    fireEvent.change(outputPriceInput(), { target: { value: "15" } });
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Cached input \/ Mtok must be a non-negative number/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("sends all-null prices on a fully blank block", async () => {
    const create = vi.fn().mockResolvedValue({ slug: "claude-sonnet-4-5" });
    renderPage(vi.fn(), create);
    enterName();
    fireEvent.click(saveButton());

    // A blank block is "not entered": nulls, which an update reads as
    // preserving the stored price rather than clearing it.
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const body = create.mock.calls[0]![0];
    expect(body.listPriceInputPerMtok).toBeNull();
    expect(body.listPriceCachedInputPerMtok).toBeNull();
    expect(body.listPriceOutputPerMtok).toBeNull();
    expect(body.listPriceAsOf).toBeNull();
  });
});

describe("ModelConfigPage's save failure", () => {
  const saveButton = () => screen.getByRole("button", { name: "Create model" });

  it("reports the failure above the button that raised it", async () => {
    renderPage(
      vi.fn(),
      vi.fn().mockRejectedValue(new Error("slug already taken")),
    );
    fireEvent.change(nameInput(), { target: { value: "Hand-written" } });
    fireEvent.click(saveButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("slug already taken");
    // Above, not below: an error rendered after the actions sits past the fold on
    // a form this tall, so the press reads as having done nothing at all.
    expect(
      alert.compareDocumentPosition(saveButton()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("re-enables the button so the operator can fix it and retry", async () => {
    renderPage(vi.fn(), vi.fn().mockRejectedValue(new Error("nope")));
    fireEvent.change(nameInput(), { target: { value: "Hand-written" } });
    fireEvent.click(saveButton());

    await screen.findByRole("alert");
    expect(saveButton()).not.toBeDisabled();
  });
});

// Editing an existing model resolves it out of the catalog, and the three
// outcomes of that read must stay three. Reporting a failed read as "Unknown
// model" invites the operator to go and create a duplicate of a model the
// cabinet already holds.
describe("ModelConfigPage when the edited model does not resolve", () => {
  function renderEdit(modelsStatus: string) {
    render(
      <MemoryRouter initialEntries={["/models/claude/edit"]}>
        <GalleryDataProvider value={galleryValue(modelsStatus)}>
          <BackendProvider value={backendValue(vi.fn(), vi.fn())}>
            <Routes>
              <Route
                path="/models/:modelId/edit"
                element={<ModelConfigPage />}
              />
            </Routes>
          </BackendProvider>
        </GalleryDataProvider>
      </MemoryRouter>,
    );
  }

  it("waits rather than calling the model unknown while the catalog loads", () => {
    renderEdit("loading");
    expect(screen.getByText("Resolving model…")).toBeTruthy();
    expect(screen.queryByText(/Unknown model/)).toBeNull();
  });

  it("reports a failed catalog read as a failure", () => {
    renderEdit("error");
    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load the model catalog",
    );
    expect(screen.queryByText(/Unknown model/)).toBeNull();
  });

  it("names the model unknown once the catalog has settled without it", () => {
    renderEdit("ready");
    expect(screen.getByText(/Unknown model: claude/)).toBeTruthy();
  });
});
