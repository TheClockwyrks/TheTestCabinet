import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { SegmentedControl, Spinner, StatusGlyph } from "@test-cabinet/ui";
import type {
  ModelProbe,
  ModelProbeDetail,
  ModelProbeItem,
  ModelProbeProvider,
  ModelProbeTriggerInput,
  ModelProbeVerdict,
} from "../../../../client/types";
import { ResetControl } from "../../../components/ResetControl";
import { SubmitNotice } from "../../../components/SubmitNotice";
import type { ModelSummary } from "../../../data/models";
import {
  useModelProbeActions,
  useModelProbeDetail,
  useModelProbes,
  type ModelProbeActions,
} from "../../../data/useModelProbes";
import { formatCompact, formatTimestamp } from "../../../format";
import { ModelDetailLayout } from "../../../layouts/models/ModelDetailLayout";
import styles from "./ModelProbesPage.module.scss";

// The sampling defaults the backend applies to an empty trigger body — seeded
// into the form so every control shows the value that will actually run, with a
// reset control appearing beside the label once it has been moved.
const DEFAULT_SAMPLES = 3;
const DEFAULT_MAX_TOKENS = 3500;

// The Probes tab (`/models/:modelId/probes`): responses-as-code readiness
// probes of the model — the backend replays gg's real RaC turn-1 request over a
// fixed prompt-condition matrix via OpenRouter, classifies each reply, and
// stores a verdict. The tab is one page: trigger controls (signed-in only) at
// the top, the probe history below, and the selected probe's full detail — the
// per-condition rollup, every call's classification and raw reply, and the
// request as sent.
export function ModelProbesPage() {
  return (
    <ModelDetailLayout tab="probes">
      {({ model }) => <ProbesContent key={model.slug} model={model} />}
    </ModelDetailLayout>
  );
}

function ProbesContent({ model }: { model: ModelSummary }) {
  const { state, prepend } = useModelProbes(model.slug);
  const actions = useModelProbeActions();
  // The operator's explicit pick; the newest probe stands in until they make
  // one (and after a trigger, the just-created probe is picked explicitly).
  const [pickedId, setPickedId] = useState<string | null>(null);
  const probes = state.status === "ready" ? state.probes : [];
  const selectedId =
    pickedId && probes.some((probe) => probe.id === pickedId)
      ? pickedId
      : (probes[0]?.id ?? null);
  const detail = useModelProbeDetail(selectedId);

  return (
    <div className={styles.page}>
      {actions ? (
        <ProbeTriggerForm
          model={model}
          actions={actions}
          onTriggered={(probe) => {
            prepend(probe);
            setPickedId(probe.id);
          }}
        />
      ) : (
        <p className={styles.notice}>
          Sign in to run probes — use the account control in the top bar. The
          probe history below is public.
        </p>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Probe history</h2>
        {state.status === "loading" && (
          <Spinner variant="flap" label="Loading probes…" />
        )}
        {state.status === "unavailable" && (
          <p className={styles.empty}>Probes are not available here.</p>
        )}
        {state.status === "error" && (
          <p className={styles.notice} role="alert">
            Could not load the probe history: {state.message}
          </p>
        )}
        {state.status === "ready" &&
          (probes.length === 0 ? (
            <p className={styles.empty}>
              No probes yet.{" "}
              {actions
                ? "Run one above to check the model's responses-as-code readiness."
                : ""}
            </p>
          ) : (
            <ProbeHistory
              probes={probes}
              selectedId={selectedId}
              onSelect={setPickedId}
            />
          ))}
      </section>

      {selectedId && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Probe detail</h2>
          {detail.status === "loading" && (
            <Spinner variant="flap" label="Loading probe…" />
          )}
          {detail.status === "error" && (
            <p className={styles.notice} role="alert">
              Could not load the probe: {detail.message}
            </p>
          )}
          {detail.status === "ready" && <ProbeDetail detail={detail.detail} />}
        </section>
      )}
    </div>
  );
}

// ---- Trigger controls --------------------------------------------------------

// One labeled form field. The label is a real `<label for>` rather than a
// wrapper, so the reset control beside it never steals the association (a
// `<button>` inside a wrapping `<label>` becomes the labeled control).
function Field({
  label,
  modified,
  onReset,
  children,
}: {
  label: string;
  modified: boolean;
  onReset: () => void;
  children: (controlId: string) => ReactNode;
}) {
  const controlId = useId();
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>
        <label htmlFor={controlId}>{label}</label>
        {modified && <ResetControl label={label} onReset={onReset} />}
      </span>
      {children(controlId)}
    </div>
  );
}

function ProbeTriggerForm({
  model,
  actions,
  onTriggered,
}: {
  model: ModelSummary;
  actions: ModelProbeActions;
  onTriggered: (probe: ModelProbe) => void;
}) {
  // The provider routes OpenRouter lists for the model, loaded lazily on mount.
  // A failed enumeration (no OpenRouter slug, network) degrades the select to
  // the default route only rather than blocking the form.
  const [providers, setProviders] = useState<ModelProbeProvider[]>([]);
  const [provider, setProvider] = useState("");
  const [samples, setSamples] = useState(String(DEFAULT_SAMPLES));
  const [maxTokens, setMaxTokens] = useState(String(DEFAULT_MAX_TOKENS));
  const [fullContext, setFullContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    actions
      .listProviders(model.slug)
      .then((r) => {
        if (active) setProviders(r.providers);
      })
      .catch(() => {
        /* default-route-only; the probe itself will say what's wrong */
      });
    return () => {
      active = false;
    };
  }, [actions, model.slug]);

  const samplesNum = Number.parseInt(samples, 10);
  const samplesOk =
    Number.isInteger(samplesNum) && samplesNum >= 1 && samplesNum <= 8;
  const maxTokensNum = Number.parseInt(maxTokens, 10);
  const maxTokensOk =
    Number.isInteger(maxTokensNum) &&
    maxTokensNum >= 256 &&
    maxTokensNum <= 16000;
  const canRun = samplesOk && maxTokensOk && !busy;

  const onRun = () => {
    const input: ModelProbeTriggerInput = {
      samples: samplesNum,
      maxTokens: maxTokensNum,
      fullContext,
    };
    if (provider) input.provider = provider;
    setBusy(true);
    setError(null);
    actions
      .trigger(model.slug, input)
      .then((probe) => {
        setBusy(false);
        onTriggered(probe);
      })
      .catch((e) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <div className={styles.trigger}>
      <div className={styles.triggerFields}>
        <Field
          label="Provider"
          modified={provider !== ""}
          onReset={() => setProvider("")}
        >
          {(id) => (
            <select
              id={id}
              className={styles.select}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="">Default route</option>
              {providers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.contextLength === null
                    ? p.name
                    : `${p.name} — ${formatCompact(p.contextLength)} ctx`}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="Samples"
          modified={samples !== String(DEFAULT_SAMPLES)}
          onReset={() => setSamples(String(DEFAULT_SAMPLES))}
        >
          {(id) => (
            <input
              id={id}
              className={styles.number}
              type="number"
              min={1}
              max={8}
              value={samples}
              onChange={(e) => setSamples(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Max tokens"
          modified={maxTokens !== String(DEFAULT_MAX_TOKENS)}
          onReset={() => setMaxTokens(String(DEFAULT_MAX_TOKENS))}
        >
          {(id) => (
            <input
              id={id}
              className={styles.number}
              type="number"
              min={256}
              max={16000}
              step={100}
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Full context"
          modified={fullContext}
          onReset={() => setFullContext(false)}
        >
          {(id) => (
            <input
              id={id}
              className={styles.checkbox}
              type="checkbox"
              checked={fullContext}
              onChange={(e) => setFullContext(e.target.checked)}
            />
          )}
        </Field>
        <button
          type="button"
          className={styles.run}
          onClick={onRun}
          disabled={!canRun}
          title={
            samplesOk
              ? maxTokensOk
                ? "Replay gg's RaC turn-1 request across the condition matrix and classify each reply"
                : "Max tokens must be between 256 and 16000"
              : "Samples must be between 1 and 8"
          }
        >
          {busy ? "Starting…" : "Run probe"}
        </button>
      </div>
      <SubmitNotice message={error} />
    </div>
  );
}

// ---- History -----------------------------------------------------------------

const VERDICT_META: Record<
  ModelProbeVerdict,
  { label: string; title: string }
> = {
  ready: {
    label: "Ready",
    title: "Clean bare programs without prompt variations",
  },
  "ready-with-reminders": {
    label: "Ready with reminders",
    title: "Clean only with a no-tools clause or trailing notice added",
  },
  "tool-call-overfit": {
    label: "Tool-call overfit",
    title: "Keeps reaching for tool calls instead of writing the program",
  },
  "not-ready": {
    label: "Not ready",
    title: "No condition produced a usable share of clean programs",
  },
};

// A probe's verdict as a color-coded chip, following the `RatingBadge`
// pattern (one element, tone selected by data attribute).
function VerdictBadge({ verdict }: { verdict: ModelProbeVerdict }) {
  const meta = VERDICT_META[verdict];
  return (
    <span className={styles.verdict} data-verdict={verdict} title={meta.title}>
      {meta.label}
    </span>
  );
}

// A clean rate (0..=1) as a whole percentage, or an em dash when unknown.
function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

// A probe's USD spend at four decimals — probe calls cost fractions of a cent,
// so the cents-precision run formatter would read as $0.00 for most probes.
function formatSpend(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function ProbeHistory({
  probes,
  selectedId,
  onSelect,
}: {
  probes: ModelProbe[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className={styles.history}>
      {probes.map((probe) => (
        <li key={probe.id}>
          <button
            type="button"
            className={
              probe.id === selectedId
                ? `${styles.row} ${styles.rowSelected}`
                : styles.row
            }
            aria-pressed={probe.id === selectedId}
            onClick={() => onSelect(probe.id)}
          >
            <span className={styles.rowWhen}>
              {formatTimestamp(probe.createdAt)}
            </span>
            <span className={styles.rowProvider}>
              {probe.provider ?? "default route"}
            </span>
            <span className={styles.rowStatus}>
              {probe.status === "running" && (
                <>
                  <Spinner variant="flap" className={styles.rowSpinner} />
                  Running
                </>
              )}
              {probe.status === "failed" && (
                <span
                  className={styles.failed}
                  title={probe.error ?? undefined}
                >
                  Failed
                </span>
              )}
              {probe.status === "complete" && probe.verdict && (
                <VerdictBadge verdict={probe.verdict} />
              )}
            </span>
            <span className={styles.rowRates}>
              base {formatRate(probe.baseCleanRate)} · best{" "}
              {formatRate(probe.bestVariationCleanRate)}
            </span>
            <span className={styles.rowSpend}>{formatSpend(probe.spend)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---- Detail ------------------------------------------------------------------

type DetailView = "results" | "request";

function ProbeDetail({ detail }: { detail: ModelProbeDetail }) {
  const [view, setView] = useState<DetailView>("results");
  const { probe } = detail;
  return (
    <div className={styles.detail}>
      <div className={styles.summaryRow}>
        {probe.status === "running" && (
          <Spinner variant="flap" label="Probing…" />
        )}
        {probe.status === "complete" && probe.verdict && (
          <VerdictBadge verdict={probe.verdict} />
        )}
        {probe.status === "failed" && (
          <span className={styles.failed}>Failed</span>
        )}
        <span className={styles.summaryFact}>
          base {formatRate(probe.baseCleanRate)} · best variation{" "}
          {formatRate(probe.bestVariationCleanRate)}
        </span>
        <span className={styles.summaryFact}>{formatSpend(probe.spend)}</span>
      </div>
      <p className={styles.configLine}>
        {probe.openrouterSlug} via {probe.provider ?? "the default route"} ·{" "}
        {probe.samples} sample{probe.samples === 1 ? "" : "s"} per condition ·{" "}
        {probe.maxTokens} max tokens · {probe.fullContext ? "full" : "trimmed"}{" "}
        context
      </p>
      {probe.error && (
        <p className={styles.notice} role="alert">
          {probe.error}
        </p>
      )}

      <SegmentedControl<DetailView>
        options={[
          { value: "results", label: "Results" },
          { value: "request", label: "Request" },
        ]}
        value={view}
        onChange={setView}
        ariaLabel="Probe view"
      />

      {view === "results" ? (
        <ProbeResults detail={detail} />
      ) : (
        <ProbeRequest detail={detail} />
      )}
    </div>
  );
}

// Distinct non-null values of one item field, joined for a rollup cell.
function distinct(values: (string | null)[]): string {
  const seen = [...new Set(values.filter((v): v is string => v !== null))];
  return seen.length === 0 ? "—" : seen.join(", ");
}

function ProbeResults({ detail }: { detail: ModelProbeDetail }) {
  // Items grouped per matrix condition, in the matrix's own order — computed
  // client-side, since the wire carries the flat item list only.
  const rollup = useMemo(
    () =>
      detail.conditions.map((condition) => {
        const items = detail.items.filter(
          (item) => item.condition === condition.name,
        );
        return {
          condition,
          items,
          clean: items.filter((item) => item.clean).length,
        };
      }),
    [detail],
  );
  const ordered = useMemo(
    () => rollup.flatMap((group) => group.items),
    [rollup],
  );

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.rollup}>
          <thead>
            <tr>
              <th>Condition</th>
              <th>Clean</th>
              <th>Labels</th>
              <th>Providers</th>
              <th>Finish reasons</th>
            </tr>
          </thead>
          <tbody>
            {rollup.map(({ condition, items, clean }) => (
              <tr key={condition.name}>
                <td className={styles.conditionCell}>
                  {condition.name}
                  {condition.variation && (
                    <span
                      className={styles.variationTag}
                      title="Counts as a variation in the verdict"
                    >
                      variation
                    </span>
                  )}
                </td>
                <td>{items.length === 0 ? "—" : `${clean}/${items.length}`}</td>
                <td>{distinct(items.map((item) => item.label))}</td>
                <td>{distinct(items.map((item) => item.provider))}</td>
                <td>{distinct(items.map((item) => item.finishReason))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ordered.length === 0 ? (
        <p className={styles.empty}>
          {detail.probe.status === "running"
            ? "No calls recorded yet."
            : "The probe recorded no calls."}
        </p>
      ) : (
        <ul className={styles.items}>
          {ordered.map((item) => (
            <ProbeItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </>
  );
}

// One call, collapsed to its classification line; expanding reveals the raw
// reply (and reasoning stream) verbatim.
function ProbeItemRow({ item }: { item: ModelProbeItem }) {
  return (
    <li>
      <details className={styles.item}>
        <summary className={styles.itemSummary}>
          <StatusGlyph
            status={item.error ? "none" : item.clean ? "pass" : "fail"}
            label={item.error ? "Errored" : item.clean ? "Clean" : "Not clean"}
          />
          <span className={styles.itemCondition}>
            {item.condition} #{item.sample}
          </span>
          <span className={styles.itemLabel}>
            {item.label ?? (item.error ? "error" : "—")}
          </span>
          <span className={styles.itemMeta}>
            {item.provider ?? "—"} · {item.finishReason ?? "—"} ·{" "}
            {(item.durationMs / 1000).toFixed(1)}s ·{" "}
            {item.cost === null ? "—" : formatSpend(item.cost)}
          </span>
        </summary>
        <div className={styles.itemBody}>
          {item.error && (
            <p className={styles.notice} role="alert">
              {item.error}
            </p>
          )}
          <p className={styles.itemFacts}>
            {item.promptTokens ?? "—"} prompt tokens ·{" "}
            {item.completionTokens ?? "—"} completion tokens
            {item.nativeFinishReason
              ? ` · native finish: ${item.nativeFinishReason}`
              : ""}
          </p>
          {item.reasoningText && (
            <>
              <h3 className={styles.rawTitle}>Reasoning</h3>
              <pre className={styles.raw}>{item.reasoningText}</pre>
            </>
          )}
          <h3 className={styles.rawTitle}>Response</h3>
          <pre className={styles.raw}>
            {item.responseText === "" ? "(empty)" : item.responseText}
          </pre>
        </div>
      </details>
    </li>
  );
}

// What was sent: the base condition's message array verbatim, then the
// additions the variation conditions layer on top of it.
function ProbeRequest({ detail }: { detail: ModelProbeDetail }) {
  const withClause = detail.conditions
    .filter((condition) => condition.noToolsClause)
    .map((condition) => condition.name);
  const withNotice = detail.conditions
    .filter((condition) => condition.trailingNotice)
    .map((condition) => condition.name);
  return (
    <div className={styles.request}>
      {detail.requestMessages.map((message, index) => (
        <div key={index}>
          <h3 className={styles.rawTitle}>{message.role}</h3>
          <pre className={styles.raw}>{message.content}</pre>
        </div>
      ))}
      <div>
        <h3 className={styles.rawTitle}>
          No-tools clause{" "}
          <span className={styles.rawNote}>
            appended to the system prompt by {withClause.join(", ") || "—"}
          </span>
        </h3>
        <pre className={styles.raw}>{detail.noToolsClause}</pre>
      </div>
      <div>
        <h3 className={styles.rawTitle}>
          Trailing notice{" "}
          <span className={styles.rawNote}>
            appended as a user message by {withNotice.join(", ") || "—"}
          </span>
        </h3>
        <pre className={styles.raw}>{detail.noticeMessage}</pre>
      </div>
    </div>
  );
}
