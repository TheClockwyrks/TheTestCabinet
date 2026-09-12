// The Metrics tab as a reader meets it: the whole app, the real router, the real
// charts, against a host holding a real (if small) cohort of runs.
//
// The unit suites under `primitives/` prove the widgets draw what they claim.
// What only this level can prove is that the page wires them up the way the tab
// is documented: the ORDER control linked across every chart, the DISPLAY
// control emphatically not, and both of them landing in the same header row.

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { GalleryApp } from "../../../GalleryApp";
import type { GalleryDataInput } from "../../../data/galleryContext";
import { routes } from "../../../routes";
import {
  FIXTURE_IDS,
  HostProviders,
  readOnlyGallery,
  stockedGallery,
} from "../../routeSmokeFixtures";

afterEach(cleanup);

async function visit(path: string, data: GalleryDataInput): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <HostProviders data={data}>
          <GalleryApp />
        </HostProviders>
      </MemoryRouter>,
    );
  });
}

/** One chart widget's header row — the title and every control beside it. */
function header(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: title });
  const row = heading.closest("header");
  if (!row) throw new Error(`the "${title}" chart has no header row`);
  return row;
}

const METRICS = routes.testCaseMetrics(FIXTURE_IDS.slug);

describe("the Metrics tab's chart controls", () => {
  it("gives the two resource charts a display control and the rest none", async () => {
    // The user asked for tokens and cost. Points is a bounded fraction of one
    // checklist and Ratings is already a per-run count, so neither gains a
    // distribution view — if that changes, this is the test to change with it.
    await visit(METRICS, stockedGallery("run-metrics-1"));
    expect(
      screen.getByRole("radiogroup", { name: "Average tokens display" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Average cost display" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("radiogroup", { name: "Average points display" }),
    ).not.toBeInTheDocument();
  });

  it("puts the display control in the same header row as the order control", async () => {
    await visit(METRICS, stockedGallery("run-metrics-2"));
    const tokens = header("Average tokens");
    expect(
      within(tokens).getByRole("radiogroup", {
        name: "Average tokens display",
      }),
    ).toBeInTheDocument();
    expect(
      within(tokens).getByRole("radiogroup", { name: "Chart order" }),
    ).toBeInTheDocument();
  });

  it("switches one chart to Scatter without moving the other", async () => {
    await visit(METRICS, stockedGallery("run-metrics-3"));
    const tokensControl = screen.getByRole("radiogroup", {
      name: "Average tokens display",
    });
    await act(async () => {
      within(tokensControl).getByRole("radio", { name: "Scatter" }).click();
    });

    expect(
      within(
        screen.getByRole("radiogroup", { name: "Average tokens display" }),
      ).getByRole("radio", { name: "Scatter" }),
    ).toBeChecked();
    // The cost chart is describing the same roster and stays where it was: the
    // display control is per chart, unlike the order control beside it.
    expect(
      within(
        screen.getByRole("radiogroup", { name: "Average cost display" }),
      ).getByRole("radio", { name: "Bar" }),
    ).toBeChecked();
    expect(
      screen.getByRole("img", {
        name: "Average tokens by harness & model (every run)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Average cost by harness & model" }),
    ).toBeInTheDocument();
  });

  it("links a scatter's dots to the runs behind them", async () => {
    await visit(METRICS, stockedGallery("run-metrics-4"));
    const control = screen.getByRole("radiogroup", {
      name: "Average cost display",
    });
    await act(async () => {
      within(control).getByRole("radio", { name: "Scatter" }).click();
    });
    const figure = screen.getByRole("img", {
      name: "Average cost by harness & model (every run)",
    });
    const links = [...figure.querySelectorAll("a")].map((link) =>
      link.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
    );
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(href).toMatch(/^\/runs\//);
    }
  });

  it("routes a click on a dot through the app instead of reloading it", async () => {
    // Plot builds the dot's anchor outside React's tree, so a plain left click
    // would otherwise leave the app and fetch the run page from the server.
    await visit(METRICS, stockedGallery("run-metrics-7"));
    const control = screen.getByRole("radiogroup", {
      name: "Average cost display",
    });
    await act(async () => {
      within(control).getByRole("radio", { name: "Scatter" }).click();
    });
    const link = screen
      .getByRole("img", {
        name: "Average cost by harness & model (every run)",
      })
      .querySelector("a");
    expect(link).not.toBeNull();

    const plain = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      link!.dispatchEvent(plain);
    });
    expect(plain.defaultPrevented).toBe(true);
  });

  it("leaves a modified click to the browser, so a dot opens in a new tab", async () => {
    await visit(METRICS, stockedGallery("run-metrics-8"));
    const control = screen.getByRole("radiogroup", {
      name: "Average cost display",
    });
    await act(async () => {
      within(control).getByRole("radio", { name: "Scatter" }).click();
    });
    const link = screen
      .getByRole("img", {
        name: "Average cost by harness & model (every run)",
      })
      .querySelector("a");
    const modified = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    await act(async () => {
      link!.dispatchEvent(modified);
    });
    expect(modified.defaultPrevented).toBe(false);
  });

  it("renders on the read-only static gallery, which has no backend", async () => {
    // The site host builds its data from a build-time snapshot. Nothing the
    // charts need may reach for a console.
    await visit(METRICS, readOnlyGallery("run-metrics-5"));
    expect(
      screen.getByRole("radiogroup", { name: "Average cost display" }),
    ).toBeInTheDocument();
  });
});

describe("the game jam's Metrics tab", () => {
  it("renders the shared metrics body under the jam layout", async () => {
    // `JamMetricsPage` is `MetricsContent` under a different layout, so every
    // change here lands there too. The jam fixture holds no runs of its own, so
    // what this asserts is that the shared body reaches its own empty state
    // rather than throwing on the way.
    await visit(
      routes.gameJamMetrics(FIXTURE_IDS.jamSlug),
      stockedGallery("run-metrics-6"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/chart a distribution/i)).toBeInTheDocument();
  });
});
