import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { SettingRow } from "../../components/SettingRow";
import { HelpTip } from "../../components/HelpTip";
import { ModelLogoPicker } from "../../components/ModelLogoPicker";
import { useConfirm } from "../../components/ConfirmDialog";
import { useModelConfig } from "../../data/useModelConfig";
import { useModels } from "../../data/useModels";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { routes } from "../../routes";
import {
  Button,
  ControlRow,
  Input,
  Select,
  Textarea,
} from "../../../primitives";
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
        <div className={styles.group}>
          {/* The OpenRouter slug leads the form: it is what prices the model, and
            the one field that can fill the rest of them in. */}
          <SettingRow
            label="OpenRouter slug"
            description="Fill copies the name, provider, description and list price OpenRouter publishes."
            help="Fill replaces those fields rather than filling only the blanks, and claims the slug as the first model id while the list is empty. Nothing is saved until Save."
          >
            {(id) => (
              <Control wide>
                <ControlRow>
                  <Input
                    id={id}
                    value={openrouterSlug}
                    onChange={(e) => setOpenrouterSlug(e.target.value)}
                    placeholder="e.g. anthropic/claude-opus-4.8"
                  />
                  <Button
                    size="small"
                    onClick={onFill}
                    disabled={!openrouterSlug.trim() || filling}
                  >
                    {filling ? "Filling…" : "Fill from OpenRouter"}
                  </Button>
                </ControlRow>
                {fillError && (
                  <span className={styles.fillError} role="alert">
                    {fillError}
                  </span>
                )}
              </Control>
            )}
          </SettingRow>

          <SettingRow label="Name" description="Required.">
            {(id) => (
              <Control>
                <Input
                  id={id}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Claude Opus 4.8"
                />
              </Control>
            )}
          </SettingRow>

          <SettingRow label="Provider">
            {(id) => (
              <Control>
                <Input
                  id={id}
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="e.g. Anthropic"
                />
              </Control>
            )}
          </SettingRow>

          {/* Provider mark: an svgl.app URL fetched + sanitized by the backend, with a
            live preview. Holds both the sanitized SVG and its source URL. */}
          <SettingRow
            label="Provider logo"
            description="An svgl.app URL, fetched and sanitized by the backend."
          >
            <Control wide>
              <ModelLogoPicker
                value={logoSvg}
                url={logoUrl}
                provider={provider}
                onUrlChange={setLogoUrl}
                onFetched={setLogoSvg}
              />
            </Control>
          </SettingRow>

          <SettingRow
            label="Description"
            description="Markdown, shown on the model's page."
          >
            {(id) => (
              <Control wide>
                <Textarea
                  id={id}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What the model is, when to reach for it…"
                />
              </Control>
            )}
          </SettingRow>

          {/* Aliases: the canonical model ids this entry claims, each paired with the
            harness family it is usable with — a repeatable list that always keeps at
            least one row. */}
          <SettingRow
            label="Model ids"
            description="Each id with the harness family it runs under."
            help="A Claude Code id such as claude-opus-4-8 goes under Claude Code; an OpenRouter slug such as anthropic/claude-opus-4.8 goes under Others. The run form offers a harness only the ids in its family."
          >
            <Control wide>
              <ul className={styles.aliasList}>
                {aliases.map((entry, index) => (
                  <li key={index}>
                    <ControlRow>
                      <Input
                        value={entry.slug}
                        onChange={(e) => setAliasSlug(index, e.target.value)}
                        placeholder="e.g. claude-opus-4-8"
                        aria-label={`Model id ${index + 1}`}
                      />
                      <Select
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
                      </Select>
                      <Button
                        variant="danger"
                        size="small"
                        className={styles.aliasRemove}
                        onClick={() => removeAlias(index)}
                        disabled={aliases.length <= 1}
                        title="Remove this id"
                        aria-label="Remove this id"
                      >
                        &times;
                      </Button>
                    </ControlRow>
                  </li>
                ))}
              </ul>
              <Button
                size="small"
                className={styles.aliasAdd}
                onClick={addAlias}
              >
                + Add id
              </Button>
            </Control>
          </SettingRow>
        </div>

        {/* The list price: the developer's published figures, per Mtok because
          that is the unit a pricing page publishes. The save parses them
          all-or-nothing. */}
        <div className={styles.group}>
          <h2 className={styles.groupTitle}>
            List price
            <HelpTip text="The developer's published rates in USD per Mtok, which a run's comparable cost is priced from. Saved as a set with their date, or not at all; a blank set on an existing model keeps the stored one." />
          </h2>

          <SettingRow
            label="Input / Mtok"
            description="From the developer's pricing page."
          >
            {(id) => (
              <Control>
                <Input
                  id={id}
                  value={listPriceInput}
                  onChange={(e) => setListPriceInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 5"
                />
              </Control>
            )}
          </SettingRow>

          <SettingRow label="Cached input / Mtok">
            {(id) => (
              <Control>
                <Input
                  id={id}
                  value={listPriceCachedInput}
                  onChange={(e) => setListPriceCachedInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 0.50"
                />
              </Control>
            )}
          </SettingRow>

          <SettingRow label="Output / Mtok">
            {(id) => (
              <Control>
                <Input
                  id={id}
                  value={listPriceOutput}
                  onChange={(e) => setListPriceOutput(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 25"
                />
              </Control>
            )}
          </SettingRow>

          <SettingRow
            label="Prices taken on"
            description="The date the rates were read."
          >
            {(id) => (
              <Control>
                <Input
                  id={id}
                  type="date"
                  value={listPriceAsOf}
                  onChange={(e) => setListPriceAsOf(e.target.value)}
                />
              </Control>
            )}
          </SettingRow>
        </div>

        {/* The provider policy: what a gg run's candidate list is filtered by.
          Every field is optional; blank takes the figure from OpenRouter's
          endpoints listing. */}
        <div className={styles.group}>
          <h2 className={styles.groupTitle}>
            Providers for gg runs
            <HelpTip text="A gg run uses the providers OpenRouter lists that serve the model at its native quantization, at or below the developer's prices, with a cache-read price. The model's Stats tab shows the list the next run would use." />
          </h2>

          <SettingRow
            label="Developer provider"
            description="OpenRouter's name for the developer's own endpoint."
            help="Blank takes the provider matching the model id's author segment. Set it where they differ, such as qwen/… served by Alibaba."
          >
            {(id) => (
              <Control>
                <Input
                  id={id}
                  value={providerPin}
                  onChange={(e) => setProviderPin(e.target.value)}
                  placeholder="e.g. Alibaba"
                />
              </Control>
            )}
          </SettingRow>

          <SettingRow
            label="Native quantization"
            description="The level every provider must serve the model at."
            help="Blank takes the highest level any endpoint declares."
          >
            {(id) => (
              <Control>
                <Input
                  id={id}
                  value={nativeQuantization}
                  onChange={(e) => setNativeQuantization(e.target.value)}
                  placeholder="e.g. fp8"
                  list="model-quantization-levels"
                />
                <datalist id="model-quantization-levels">
                  {QUANTIZATION_LEVELS.map((level) => (
                    <option key={level} value={level} />
                  ))}
                </datalist>
              </Control>
            )}
          </SettingRow>

          <SettingRow
            label="Price ceiling, input / Mtok"
            description="USD. Set both halves or neither."
            help="Used only when OpenRouter lists no developer endpoint; otherwise that endpoint's own rates are the ceiling."
          >
            {(id) => (
              <Control>
                <Input
                  id={id}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={maxInputPrice}
                  onChange={(e) => setMaxInputPrice(e.target.value)}
                  placeholder="e.g. 0.60"
                />
              </Control>
            )}
          </SettingRow>

          <SettingRow label="Price ceiling, output / Mtok" description="USD.">
            {(id) => (
              <Control>
                <Input
                  id={id}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={maxOutputPrice}
                  onChange={(e) => setMaxOutputPrice(e.target.value)}
                  placeholder="e.g. 2.20"
                />
              </Control>
            )}
          </SettingRow>

          <SettingRow
            label="Banned providers"
            description="One per line. A gg run never uses them."
          >
            {(id) => (
              <Control>
                <Textarea
                  id={id}
                  className={styles.textareaShort}
                  value={bannedProviders}
                  onChange={(e) => setBannedProviders(e.target.value)}
                  placeholder="One provider per line"
                />
              </Control>
            )}
          </SettingRow>

          <SettingRow
            label="Unknown-quantization providers"
            description="One per line. Kept despite declaring unknown quantization."
            help="Every other endpoint declaring unknown quantization is left out."
          >
            {(id) => (
              <Control>
                <Textarea
                  id={id}
                  className={styles.textareaShort}
                  value={unknownQuantizationProviders}
                  onChange={(e) =>
                    setUnknownQuantizationProviders(e.target.value)
                  }
                  placeholder="One provider per line"
                />
              </Control>
            )}
          </SettingRow>
        </div>

        <SubmitNotice message={error} />

        <div className={styles.actions}>
          <Button variant="primary" onClick={onSave} disabled={!canSave}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create model"}
          </Button>
          {editing && (
            <Button
              variant="danger"
              size="small"
              className={styles.deleteButton}
              onClick={onDelete}
              disabled={busy}
              title="Delete this model configuration"
            >
              Delete
            </Button>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

// A row's control column: a fixed width so every input lines up on the panel's
// right edge, `wide` for the controls that hold a list, a picker, or prose.
function Control({
  wide = false,
  children,
}: {
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        wide ? `${styles.control} ${styles.controlWide}` : styles.control
      }
    >
      {children}
    </div>
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
