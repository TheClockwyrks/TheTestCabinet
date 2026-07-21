// Build the Grafana Explore deep link that shows a run's traces.
//
// A run is not one trace. Every component that participates — the driver, the
// artifact service, the harness itself — emits its own traces, and they are tied
// together by a shared `run.id` attribute rather than by a common trace ID. So the
// link runs a TraceQL *search* for that attribute rather than opening a single
// trace, and the result is the set of traces the run produced.
//
// The `tempo` datasource UID is provisioned by the grafana/otel-lgtm image and is
// stable for the version pinned in the observability component
// (deployments/k8s/components/observability/lgtm.yaml). It is version-coupled to
// that pin in the same way the Loki config copy is.
const TEMPO_DATASOURCE_UID = "tempo";

// Padding either side of the run's own window. Spans are timestamped when they
// end, and the driver keeps working (uploading artifacts, publishing) after the
// harness session closes, so a window clamped exactly to the record's start/finish
// clips traces at both edges.
const PADDING_MS = 5 * 60 * 1000;

/** The timing fields this needs from a run record. */
export interface TraceWindow {
  startedAt: string;
  finishedAt: string;
}

/**
 * The Grafana Explore URL listing every trace tagged with this run's ID, or null
 * when no Grafana is configured for this deployment.
 *
 * The time window is derived from the run itself rather than a relative default:
 * a run being investigated is often not a recent one, and Explore opening on
 * "last 6 hours" would show nothing for it. Note that traces still age out under
 * the collector's retention (24h on staging, 72h on prod), so a correct window is
 * necessary but not sufficient for old runs — the link can legitimately land on an
 * empty result.
 */
export function grafanaTraceUrl(
  grafanaUrl: string | null,
  runId: string,
  window: TraceWindow,
): string | null {
  if (!grafanaUrl) return null;

  const from = epochMs(window.startedAt);
  const to = epochMs(window.finishedAt);
  // An unparseable timestamp is not worth suppressing the link over; fall back to
  // a relative window wide enough to cover any retained trace.
  const range =
    from === null || to === null
      ? { from: "now-7d", to: "now" }
      : { from: String(from - PADDING_MS), to: String(to + PADDING_MS) };

  // Grafana 11+ encodes Explore state as a `panes` object keyed by pane ID.
  const panes = {
    traces: {
      datasource: TEMPO_DATASOURCE_UID,
      queries: [
        {
          refId: "A",
          datasource: { type: "tempo", uid: TEMPO_DATASOURCE_UID },
          queryType: "traceql",
          // Quotes are part of TraceQL's string syntax; the whole query is
          // URL-encoded below, so they need no escaping beyond that.
          query: `{ .run.id = "${runId}" }`,
          limit: 100,
        },
      ],
      range,
    },
  };

  const params = new URLSearchParams({
    schemaVersion: "1",
    orgId: "1",
    panes: JSON.stringify(panes),
  });
  return `${grafanaUrl.replace(/\/+$/, "")}/explore?${params.toString()}`;
}

/** Epoch milliseconds for an RFC 3339 timestamp, or null if it can't be parsed. */
function epochMs(timestamp: string): number | null {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}
