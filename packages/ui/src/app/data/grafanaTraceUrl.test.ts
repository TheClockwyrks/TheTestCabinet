import { describe, expect, it } from "vitest";
import { grafanaTraceUrl } from "./grafanaTraceUrl";

const RUN_ID = "4c03bd5d-3b0e-4721-a825-ad7d2255104d";
const WINDOW = {
  startedAt: "2026-07-21T02:00:00Z",
  finishedAt: "2026-07-21T02:10:00Z",
};

/** The `panes` query parameter, decoded back into an object. */
function panesOf(url: string) {
  const panes = new URL(url).searchParams.get("panes");
  expect(panes).not.toBeNull();
  return JSON.parse(panes as string);
}

describe("grafanaTraceUrl", () => {
  it("returns null when the deployment has no Grafana", () => {
    // The static gallery site and any console whose backend reports no
    // `grafanaUrl` must not render a link to nowhere.
    expect(grafanaTraceUrl(null, RUN_ID, WINDOW)).toBeNull();
  });

  it("searches by run id rather than opening a single trace", () => {
    // A run spans many traces correlated by attribute, so the query has to be a
    // TraceQL search — opening one trace ID would show a fraction of the run.
    const url = grafanaTraceUrl("https://grafana.example", RUN_ID, WINDOW);
    const query = panesOf(url as string).traces.queries[0];
    expect(query.queryType).toBe("traceql");
    expect(query.query).toBe(`{ .run.id = "${RUN_ID}" }`);
  });

  it("scopes the time window to the run, padded on both sides", () => {
    // Explore's default relative range would show nothing for any run that is not
    // recent, which is precisely the run someone is investigating.
    const url = grafanaTraceUrl("https://grafana.example", RUN_ID, WINDOW);
    const range = panesOf(url as string).traces.range;
    expect(Number(range.from)).toBe(
      Date.parse(WINDOW.startedAt) - 5 * 60 * 1000,
    );
    expect(Number(range.to)).toBe(
      Date.parse(WINDOW.finishedAt) + 5 * 60 * 1000,
    );
  });

  it("falls back to a relative window when a timestamp is unparseable", () => {
    // A malformed record should still yield a usable link rather than none.
    const url = grafanaTraceUrl("https://grafana.example", RUN_ID, {
      startedAt: "not-a-date",
      finishedAt: "also-not-a-date",
    });
    expect(panesOf(url as string).traces.range).toEqual({
      from: "now-7d",
      to: "now",
    });
  });

  it("does not double up the slash on a base URL that has one", () => {
    const url = grafanaTraceUrl("https://grafana.example/", RUN_ID, WINDOW);
    expect(url?.startsWith("https://grafana.example/explore?")).toBe(true);
  });
});
