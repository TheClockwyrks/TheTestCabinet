import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { LoadingState } from "../../components/LoadingState";
import { LoadFailureState } from "../../components/LoadFailureState";
import type {
  HarnessFamily,
  ModelAlias,
  ModelInput,
} from "../../../client/types";
import { FAMILIES } from "../../data/families";
import { perMillion } from "../../format";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { SubmitNotice } from "../../components/SubmitNotice";
import { ModelLogoPicker } from "../../components/ModelLogoPicker";
import { useConfirm } from "../../components/ConfirmDialog";
import { useModelConfig } from "../../data/useModelConfig";
import { useModels } from "../../data/useModels";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { routes } from "../../routes";
import styles from "./ModelConfigPage.module.scss";

// The catalog slug the backend derives from a name when the form doesn't carry a
// seeded/existing one: kebab-cased, punctuation collapsed to single hyphens.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The OpenRouter slug the form edits, recovered from a catalog entry's resolved
// `openrouterUrl` (`https://openrouter.ai/<slug>`), or "" when the model has none.
function openrouterSlugFromUrl(url: string | null): string {
  if (!url) return "";
  const prefix = "https://openrouter.ai/";
  return url.startsWith(prefix) ? url.slice(prefix.length) : "";
}

// A fresh, empty alias row. New rows default to the Others / OpenRouter family —
// the namespace shared by every OpenRouter-routed harness, and the one most
// slugs belong to.
function blankAlias(): ModelAlias {
  return { slug: "", harnessFamily: "openrouter" };
}

// Ensure a prefilled/seeded alias list always has at least one row so the
// repeatable control never collapses to nothing.
function withAtLeastOneRow(aliases: ModelAlias[]): ModelAlias[] {
  return aliases.length > 0 ? aliases : [blankAlias()];
}

// A per-Mtok price field's text: the stored per-token figure scaled up, or ""
// for an unknown one. The form edits per-Mtok figures because that is the unit
// a developer pricing page publishes; the backend divides back down.
function priceField(perToken: number | null): string {
  const perMtok = perMillion(perToken);
  return perMtok === null ? "" : mtokText(perMtok);
}

// A per-Mtok figure as field text. Scaling between per-token and per-Mtok leaves
// binary floating-point noise (0.121 comes back as 0.12099999999999998), which
// twelve significant digits drop without touching any published price.
function mtokText(perMtok: number): string {
  return String(Number(perMtok.toPrecision(12)));
}

// Today's date as a `YYYY-MM-DD` string in UTC, for seeding the list price's
// "prices taken on" field — the figures were just read off the live listing.
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// Parse one list-price field's text: "" reads as "not entered" (null); anything
// else must be a finite, non-negative number, and a figure that isn't fails the
// save with a reason rather than reaching the backend as a NaN.
function parsePriceField(
  text: string,
  label: string,
): { value: number | null } | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    return {
      error: `${label} must be a non-negative number, got "${trimmed}".`,
    };
  }
  return { value };
}

// The three parsed list-price fields, narrowed past their failure arm — the
// caller reports the first failure and only calls this once none remains.
function parsedPrices(
  parsed: Array<{ value: number | null } | { error: string }>,
): [number | null, number | null, number | null] {
  const [input, cachedInput, output] = parsed.map((p) =>
    "value" in p ? p.value : null,
  );
  return [input ?? null, cachedInput ?? null, output ?? null];
}

// The add/edit model configuration form — one component covering three entry
// modes: a blank draft (`/models/new`), a draft seeded from a run of an unknown
// model (`/models/new?fromRun=<runId>`), and an existing config opened for
// revision (`/models/:modelId/edit`). It only ever mutates on an explicit Save
// (never auto-creating), refreshes the catalog, and lands on the resulting model's
// detail page. Edit mode additionally offers a confirm-gated delete. Where
// configuring models isn't possible (a read-only or logged-out host,
// `useModelConfig()` null) it shows a sign-in notice rather than crashing.
export function ModelConfigPage() {
  const config = useModelConfig();
  const { modelId } = useParams<{ modelId: string }>();
  const [params] = useSearchParams();
  const { models, status } = useModels();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const runtime = useRunsRuntime();

  // Edit mode is the `/models/:modelId/edit` route (a slug in the URL); the seed
  // and blank drafts are the paramless `/models/new`.
  const editing = Boolean(modelId);
  const existing = editing
    ? models.find((model) => model.slug === modelId)
    : undefined;
  const fromRun = params.get("fromRun");
  const alias = params.get("alias");

  const [name, setName] = useState("");
  // Always at least one alias row so the repeatable list never collapses to
  // nothing; rows with a blank slug are dropped on submit. Each row pairs a slug
  // with the harness family it is usable with (a new row defaults to Others /
  // OpenRouter, the broadest namespace).
  const [aliases, setAliases] = useState<ModelAlias[]>([blankAlias()]);
  const [provider, setProvider] = useState("");
  const [logoSvg, setLogoSvg] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [openrouterSlug, setOpenrouterSlug] = useState("");
  const [providerPin, setProviderPin] = useState("");
  // The provider policy a gg run's candidate list is filtered by. The prices are
  // kept as typed and parsed on save; the provider lists are one name per line.
  const [nativeQuantization, setNativeQuantization] = useState("");
  const [maxInputPrice, setMaxInputPrice] = useState("");
  const [maxOutputPrice, setMaxOutputPrice] = useState("");
  const [bannedProviders, setBannedProviders] = useState("");
  const [unknownQuantizationProviders, setUnknownQuantizationProviders] =
    useState("");
  // The list-price block, edited as text: per-Mtok USD figures (the unit a
  // developer pricing page publishes) plus the date they were taken. An empty
  // field reads as "not entered"; the save parses them all-or-nothing.
  const [listPriceInput, setListPriceInput] = useState("");
  const [listPriceCachedInput, setListPriceCachedInput] = useState("");
  const [listPriceOutput, setListPriceOutput] = useState("");
  const [listPriceAsOf, setListPriceAsOf] = useState("");
  // The catalog slug, kept internal: preserved from the existing model (edit) or
  // the seed, else derived from the name at submit time.
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  // The OpenRouter fill-in: in flight, and the failure from the last attempt.
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);

  // Prefill the form from the existing model once it resolves from the catalog.
  // Guarded so it runs a single time and never clobbers the user's edits on a
  // later catalog refresh.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!editing || prefilledRef.current || !existing) return;
    prefilledRef.current = true;
    setName(existing.name);
    setAliases(withAtLeastOneRow(existing.aliases));
    setProvider(existing.provider);
    setLogoSvg(existing.logoSvg);
    setDescription(existing.description ?? "");
    setOpenrouterSlug(openrouterSlugFromUrl(existing.openrouterUrl));
    // The stored figures are per-token; the fields edit them per Mtok. The date
    // is edited as a calendar date, whatever precision it was stored with.
    setListPriceInput(priceField(existing.listPrice?.uncachedInput ?? null));
    setListPriceCachedInput(
      priceField(existing.listPrice?.cachedInput ?? null),
    );
    setListPriceOutput(priceField(existing.listPrice?.output ?? null));
    setListPriceAsOf(existing.listPriceAsOf?.slice(0, 10) ?? "");
    // Only a hand-set developer provider is the form's to edit; an observed one
    // follows the listing.
    setProviderPin(
      existing.providerPinSetByHand ? (existing.providerPin ?? "") : "",
    );
    setNativeQuantization(existing.nativeQuantization ?? "");
    setMaxInputPrice(
      existing.maxInputPrice != null ? String(existing.maxInputPrice) : "",
    );
    setMaxOutputPrice(
      existing.maxOutputPrice != null ? String(existing.maxOutputPrice) : "",
    );
    setBannedProviders(existing.bannedProviders.join("\n"));
    setUnknownQuantizationProviders(
      existing.unknownQuantizationProviders.join("\n"),
    );
    setSlug(existing.slug);
  }, [editing, existing]);

  // Seed a blank draft from a run of an unknown model. Guarded so it fires once;
  // the `alias` pre-claim path resolves synchronously, while the `fromRun` path
  // waits for the config capability before attempting the seed fetch.
  const seededRef = useRef(false);
  useEffect(() => {
    if (editing || seededRef.current) return;
    if (!fromRun) {
      // A bare `/models/new`, optionally pre-claiming a single known id. The
      // family is unknown here, so the row defaults to Others / OpenRouter; the
      // operator retags it before saving if the id is a native slug.
      seededRef.current = true;
      if (alias) setAliases([{ slug: alias, harnessFamily: "openrouter" }]);
      return;
    }
    if (!config) return;
    seededRef.current = true;
    config
      .seedFromRun(fromRun)
      .then((seed) => {
        // The name deliberately stays empty — the run only knows an id, and the
        // curator writes the display name.
        setSlug(seed.slug);
        setProvider(seed.provider);
        setAliases(withAtLeastOneRow(seed.aliases));
        setOpenrouterSlug(seed.openrouterSlug ?? "");
      })
      .catch((e) => setSeedError(String(e)));
  }, [editing, fromRun, alias, config]);

  // Configuring models isn't possible here (read-only or logged-out) — show a
  // notice instead of a form that could not submit.
  if (!config) {
    return (
      <PageLayout>
        <PromptHeader
          command={editing ? "--edit-model" : "--new-model"}
          comment={<>// configure a model</>}
        />
        <p className={`${styles.notice} ${styles.warn}`}>
          Sign in to configure models. Use the account control in the top bar to
          register or log in, then return here.
        </p>
      </PageLayout>
    );
  }

  // Edit mode with the model not yet in the catalog. Three outcomes, and the
  // form must not open on any of them: the catalog read is still in flight, the
  // read failed, or the read settled and this backend curates no such model.
  // Only the last is an unknown model — reporting a failed read as one would
  // invite the operator to create a duplicate of a model that already exists.
  if (editing && !existing) {
    return (
      <PageLayout>
        <PromptHeader
          command="--edit-model"
          comment={<>// configure a model</>}
        />
        {status === "loading" ? (
          <LoadingState label="Resolving model…" />
        ) : status === "error" ? (
          <LoadFailureState subject="the model catalog" />
        ) : (
          <p className={`${styles.notice} ${styles.warn}`}>
            Unknown model: {modelId}
          </p>
        )}
      </PageLayout>
    );
  }

  const canSave = name.trim().length > 0 && !busy;

  const setAliasSlug = (index: number, slug: string) =>
    setAliases((prev) =>
      prev.map((a, i) => (i === index ? { ...a, slug } : a)),
    );
  const setAliasFamily = (index: number, harnessFamily: HarnessFamily) =>
    setAliases((prev) =>
      prev.map((a, i) => (i === index ? { ...a, harnessFamily } : a)),
    );
  const addAlias = () => setAliases((prev) => [...prev, blankAlias()]);
  const removeAlias = (index: number) =>
    setAliases((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
    );

  // Fill the curated fields in from what OpenRouter publishes for the entered
  // slug, so an operator adding a model doesn't retype a name, a provider, and a
  // blurb that OpenRouter already has, and the list-price block seeds from the
  // model's official endpoint for confirmation against the developer's pricing
  // page. The context window and the modalities the backend records for itself,
  // which is why they are not here.
  //
  // It replaces rather than merges: it runs only on an explicit press, and
  // "replace what's here from OpenRouter" is the one reading of that press that
  // doesn't leave the operator wondering which fields it decided to skip. Nothing
  // is persisted until Save, so a fill that wasn't wanted is discarded by leaving.
  const onFill = async () => {
    const slug = openrouterSlug.trim();
    if (!slug) return;
    setFilling(true);
    setFillError(null);
    try {
      const listing = await config.lookupOpenrouter(slug);
      setName(listing.name);
      setProvider(listing.provider);
      if (listing.description) setDescription(listing.description);
      // Seed the list-price fields from the official endpoint's current rates,
      // for the operator to confirm or correct against the developer's pricing
      // page. A figure the endpoint does not list seeds nothing, so the fields
      // the operator may already have filled are only ever replaced by a real
      // figure. The date is set only when blank: an entered date records when
      // *those* figures were taken, and re-dating them to today would assert
      // something the press does not know.
      if (listing.inputPerMtok !== null)
        setListPriceInput(mtokText(listing.inputPerMtok));
      if (listing.cachedInputPerMtok !== null)
        setListPriceCachedInput(mtokText(listing.cachedInputPerMtok));
      if (listing.outputPerMtok !== null)
        setListPriceOutput(mtokText(listing.outputPerMtok));
      if (
        (listing.inputPerMtok !== null ||
          listing.cachedInputPerMtok !== null ||
          listing.outputPerMtok !== null) &&
        !listPriceAsOf
      ) {
        setListPriceAsOf(todayUtc());
      }
      // The OpenRouter slug is itself a canonical model id for the OpenRouter
      // family, so an untouched alias list is worth claiming it — the row the
      // operator would otherwise fill with the exact text they just typed above.
      // A list with any id in it is left alone: those are the operator's, and one
      // of them may already be this slug under a family they chose deliberately.
      setAliases((prev) =>
        prev.some((entry) => entry.slug.trim())
          ? prev
          : [{ slug, harnessFamily: "openrouter" }],
      );
    } catch (e) {
      setFillError(String(e));
    } finally {
      setFilling(false);
    }
  };

  const onSave = async () => {
    const ceiling = parseCeiling(maxInputPrice, maxOutputPrice);
    if (typeof ceiling === "string") {
      setError(ceiling);
      return;
    }
    // The list price is all-or-nothing, matching the backend's validation: the
    // comparable cost needs every class, so a partial set is a mistake the save
    // refuses with the reason rather than a figure that prices some runs at 0.
    // A fully blank block sends all null — on update that preserves the stored
    // price rather than clearing it.
    const input = parsePriceField(listPriceInput, "Input / Mtok");
    const cached = parsePriceField(listPriceCachedInput, "Cached input / Mtok");
    const output = parsePriceField(listPriceOutput, "Output / Mtok");
    const failure = [input, cached, output].find(
      (parsed): parsed is { error: string } => "error" in parsed,
    );
    if (failure) {
      setError(failure.error);
      return;
    }
    const [listInput, listCachedInput, listOutput] = parsedPrices([
      input,
      cached,
      output,
    ]);
    const entered = [listInput, listCachedInput, listOutput].filter(
      (value) => value !== null,
    );
    if (entered.length > 0 && entered.length < 3) {
      setError(
        "Set all three list prices, or none — the comparable cost needs every class.",
      );
      return;
    }
    if (entered.length === 3 && !listPriceAsOf) {
      setError("Enter the date the list prices were taken.");
      return;
    }
    const cleanAliases = aliases
      .map((a) => ({ ...a, slug: a.slug.trim() }))
      .filter((a) => a.slug);
    const submittedSlug = (editing ? slug : slug || slugify(name)).trim();
    const body: ModelInput = {
      slug: submittedSlug,
      name: name.trim(),
      provider: provider.trim(),
      aliases: cleanAliases,
      openrouterSlug: openrouterSlug.trim() || null,
      providerPin: providerPin.trim() || null,
      nativeQuantization: nativeQuantization.trim().toLowerCase() || null,
      maxInputPrice: ceiling.input,
      maxOutputPrice: ceiling.output,
      bannedProviders: providerLines(bannedProviders),
      unknownQuantizationProviders: providerLines(unknownQuantizationProviders),
      listPriceInputPerMtok: listInput,
      listPriceCachedInputPerMtok: listCachedInput,
      listPriceOutputPerMtok: listOutput,
      listPriceAsOf: listPriceAsOf || null,
      description: description.trim() || null,
      logoSvg,
      providerLogoUrl: logoUrl.trim() || null,
    };
    setBusy(true);
    setError(null);
    try {
      const result = editing
        ? await config.updateModel(slug, body)
        : await config.createModel(body);
      // The catalog just changed, so nudge the data source to re-read it, then
      // land on the saved model's detail page.
      runtime.requestRefresh();
      navigate(routes.modelDetail(result.slug));
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!editing) return;
    if (
      !(await confirm({
        title: "Delete model configuration",
        message:
          "Delete this model configuration? The model reverts to being derived " +
          "from its runs alone (its curated name, description, and logo are " +
          "removed). This cannot be undone.",
        confirmLabel: "Delete configuration",
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await config.deleteModel(slug);
      runtime.requestRefresh();
      navigate(routes.models());
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <PageLayout>
      <PromptHeader
        command={editing ? "--edit-model" : "--new-model"}
        comment={
          editing ? (
            <>// revise {existing?.name}</>
          ) : (
            <>// add a model to the catalog</>
          )
        }
      />

      {seedError && (
        <p className={`${styles.notice} ${styles.warn}`}>
          Could not seed from that run ({seedError}). Fill the fields in by
          hand.
        </p>
      )}

      <div className={styles.form}>
        {/* The OpenRouter slug leads the form: it is what prices the model, and
          the one field that can fill the rest of them in. */}
        <div className={styles.field}>
          <span className={styles.fieldLabel}>
            OpenRouter slug (for pricing)
          </span>
          <div className={styles.fillRow}>
            <input
              className={styles.input}
              value={openrouterSlug}
              onChange={(e) => setOpenrouterSlug(e.target.value)}
              placeholder="e.g. anthropic/claude-opus-4.8"
              aria-label="OpenRouter slug"
            />
            <button
              type="button"
              className={styles.fill}
              onClick={onFill}
              disabled={!openrouterSlug.trim() || filling}
              title={
                openrouterSlug.trim()
                  ? "Replace the name, provider, and description with what OpenRouter publishes for this slug"
                  : "Enter an OpenRouter slug to fill the form from"
              }
            >
              {filling ? "Filling…" : "Fill from OpenRouter"}
            </button>
          </div>
          <span className={styles.fieldHint}>
            Fill replaces the name, provider, and description below with what
            OpenRouter publishes, and seeds the list-price fields from the
            model's official endpoint. The billed rate, the context window, and
            the input modalities are recorded automatically; the list price
            below is the operator's.
          </span>
          {fillError && (
            <span className={styles.fillError} role="alert">
              {fillError}
            </span>
          )}
        </div>

        {/* The list price: the developer's published figures, per Mtok because
          that is the unit a pricing page publishes. The save parses them
          all-or-nothing. */}
        <div className={styles.field}>
          <span className={styles.fieldLabel}>List price</span>
          <span className={styles.fieldHint}>
            The developer&apos;s published list prices — the figures a
            run&apos;s comparable cost is computed from. Enter them from the
            developer&apos;s pricing page; Fill from OpenRouter seeds them from
            the model&apos;s official endpoint for confirmation.
          </span>
          <div className={styles.priceRow}>
            <label className={styles.priceField}>
              <span className={styles.fieldLabel}>Input / Mtok</span>
              <input
                className={styles.input}
                value={listPriceInput}
                onChange={(e) => setListPriceInput(e.target.value)}
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="e.g. 5"
              />
            </label>
            <label className={styles.priceField}>
              <span className={styles.fieldLabel}>Cached input / Mtok</span>
              <input
                className={styles.input}
                value={listPriceCachedInput}
                onChange={(e) => setListPriceCachedInput(e.target.value)}
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="e.g. 0.50"
              />
            </label>
            <label className={styles.priceField}>
              <span className={styles.fieldLabel}>Output / Mtok</span>
              <input
                className={styles.input}
                value={listPriceOutput}
                onChange={(e) => setListPriceOutput(e.target.value)}
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="e.g. 25"
              />
            </label>
            <label className={styles.priceField}>
              <span className={styles.fieldLabel}>Prices taken on</span>
              <input
                className={styles.input}
                type="date"
                value={listPriceAsOf}
                onChange={(e) => setListPriceAsOf(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className={styles.fields}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Claude Opus 4.8"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Provider</span>
            <input
              className={styles.input}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="e.g. Anthropic"
            />
          </label>
        </div>

        {/* Aliases: the canonical model ids this entry claims, each paired with the
          harness family it is usable with — a repeatable list that always keeps at
          least one row. */}
        <div className={styles.aliasBlock}>
          <span className={styles.fieldLabel}>Model ids by harness family</span>
          <span className={styles.fieldHint}>
            Pair each model id with the harness family it works with: a Claude
            Code slug (e.g. <code>claude-opus-4-8</code>) under Claude Code, an
            OpenRouter slug (e.g. <code>anthropic/claude-opus-4.8</code>) under
            Others. The run form offers a harness only the slugs in its family.
          </span>
          <ul className={styles.aliasList}>
            {aliases.map((entry, index) => (
              <li key={index} className={styles.aliasRow}>
                <input
                  className={styles.input}
                  value={entry.slug}
                  onChange={(e) => setAliasSlug(index, e.target.value)}
                  placeholder="e.g. claude-opus-4-8"
                  aria-label={`Model id ${index + 1}`}
                />
                <select
                  className={styles.aliasFamily}
                  value={entry.harnessFamily}
                  onChange={(e) =>
                    setAliasFamily(index, e.target.value as HarnessFamily)
                  }
                  aria-label={`Harness family for model id ${index + 1}`}
                >
                  {FAMILIES.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.displayName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={styles.aliasRemove}
                  onClick={() => removeAlias(index)}
                  disabled={aliases.length <= 1}
                  title="Remove this id"
                  aria-label="Remove this id"
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={styles.aliasAdd} onClick={addAlias}>
            + Add id
          </button>
        </div>

        {/* Provider mark: an svgl.app URL fetched + sanitized by the backend, with a
          live preview. Holds both the sanitized SVG and its source URL. */}
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Provider logo</span>
          <ModelLogoPicker
            value={logoSvg}
            url={logoUrl}
            provider={provider}
            onUrlChange={setLogoUrl}
            onFetched={setLogoSvg}
          />
        </div>

        <label className={`${styles.field} ${styles.fieldStacked}`}>
          <span className={styles.fieldLabel}>Description (Markdown)</span>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What the model is, when to reach for it…"
          />
        </label>

        {/* The provider policy: what a gg run's candidate list is filtered by.
          Every field is optional; blank takes the figure from OpenRouter's
          endpoints listing. */}
        <div className={styles.aliasBlock}>
          <span className={styles.fieldLabel}>Providers for gg runs</span>
          <span className={styles.fieldHint}>
            A gg run of this model runs on the providers OpenRouter lists that
            serve it at its native quantization, at or below its developer's
            prices, with a cache-read price. The model's Stats tab shows the
            list the next run would use.
          </span>
        </div>

        <div className={styles.fields}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Developer provider</span>
            <input
              className={styles.input}
              value={providerPin}
              onChange={(e) => setProviderPin(e.target.value)}
              placeholder="e.g. Alibaba"
              aria-label="Developer provider"
            />
            <span className={styles.fieldHint}>
              OpenRouter's name for the developer's own endpoint. Leave blank to
              take the provider matching the model id's author segment; set it
              where they differ (<code>qwen/…</code> served by Alibaba).
            </span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Native quantization</span>
            <input
              className={styles.input}
              value={nativeQuantization}
              onChange={(e) => setNativeQuantization(e.target.value)}
              placeholder="e.g. fp8"
              aria-label="Native quantization"
              list="model-quantization-levels"
            />
            <datalist id="model-quantization-levels">
              {QUANTIZATION_LEVELS.map((level) => (
                <option key={level} value={level} />
              ))}
            </datalist>
            <span className={styles.fieldHint}>
              The level every provider must serve the model at. Leave blank to
              take the highest level any endpoint declares.
            </span>
          </label>
        </div>

        <div className={styles.fields}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Price ceiling, input / Mtok (USD)
            </span>
            <input
              className={styles.input}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={maxInputPrice}
              onChange={(e) => setMaxInputPrice(e.target.value)}
              placeholder="e.g. 0.60"
              aria-label="Price ceiling, input per Mtok"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Price ceiling, output / Mtok (USD)
            </span>
            <input
              className={styles.input}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={maxOutputPrice}
              onChange={(e) => setMaxOutputPrice(e.target.value)}
              placeholder="e.g. 2.20"
              aria-label="Price ceiling, output per Mtok"
            />
          </label>
        </div>
        <span className={`${styles.fieldHint} ${styles.fieldBlockHint}`}>
          Used only when OpenRouter lists no developer endpoint, since that
          endpoint's own rates are the ceiling. Set both or neither.
        </span>

        <div className={styles.fields}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Banned providers</span>
            <textarea
              className={`${styles.textarea} ${styles.textareaShort}`}
              value={bannedProviders}
              onChange={(e) => setBannedProviders(e.target.value)}
              placeholder={"One provider per line"}
              aria-label="Banned providers"
            />
            <span className={styles.fieldHint}>
              Providers a gg run of this model never uses.
            </span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Unknown-quantization providers
            </span>
            <textarea
              className={`${styles.textarea} ${styles.textareaShort}`}
              value={unknownQuantizationProviders}
              onChange={(e) => setUnknownQuantizationProviders(e.target.value)}
              placeholder={"One provider per line"}
              aria-label="Unknown-quantization providers"
            />
            <span className={styles.fieldHint}>
              Providers kept despite declaring <code>unknown</code>{" "}
              quantization. Every other <code>unknown</code> endpoint is left
              out.
            </span>
          </label>
        </div>

        <SubmitNotice message={error} />

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={onSave}
            disabled={!canSave}
          >
            {busy ? "Saving…" : editing ? "Save changes" : "Create model"}
          </button>
          {editing && (
            <button
              type="button"
              className={styles.deleteButton}
              onClick={onDelete}
              disabled={busy}
              title="Delete this model configuration"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

// The quantization levels OpenRouter declares, best first — the native levels
// the form offers (the backend refuses any other).
const QUANTIZATION_LEVELS = [
  "fp32",
  "bf16",
  "fp16",
  "fp8",
  "int8",
  "fp6",
  "fp4",
  "int4",
];

// A provider list typed one name per line: trimmed, blank lines dropped.
function providerLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// The price ceiling as typed: both halves blank is no ceiling, both set to
// positive numbers is the ceiling, and anything else is the reason it is
// refused (the backend holds the same rule).
function parseCeiling(
  input: string,
  output: string,
): { input: number | null; output: number | null } | string {
  const typedInput = input.trim();
  const typedOutput = output.trim();
  if (!typedInput && !typedOutput) return { input: null, output: null };
  if (!typedInput || !typedOutput) {
    return "Set both halves of the price ceiling, or neither.";
  }
  const parsedInput = Number(typedInput);
  const parsedOutput = Number(typedOutput);
  if (
    !Number.isFinite(parsedInput) ||
    !Number.isFinite(parsedOutput) ||
    parsedInput <= 0 ||
    parsedOutput <= 0
  ) {
    return "The price ceiling must be two prices above zero, in USD per million tokens.";
  }
  return { input: parsedInput, output: parsedOutput };
}
