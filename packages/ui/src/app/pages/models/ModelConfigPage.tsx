import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { HarnessFamily, ModelAlias, ModelInput } from "../../../client/types";
import { FAMILIES } from "../../data/families";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { ModelLogoPicker } from "../../components/ModelLogoPicker";
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
  // The catalog slug, kept internal: preserved from the existing model (edit) or
  // the seed, else derived from the name at submit time.
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

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

  // Edit mode with the model not yet in the catalog: still loading, or genuinely
  // unknown once the catalog has settled.
  if (editing && !existing) {
    return (
      <PageLayout>
        <PromptHeader command="--edit-model" comment={<>// configure a model</>} />
        {status === "loading" ? (
          <p className={styles.notice}>Resolving model…</p>
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
    setAliases((prev) => prev.map((a, i) => (i === index ? { ...a, slug } : a)));
  const setAliasFamily = (index: number, harnessFamily: HarnessFamily) =>
    setAliases((prev) =>
      prev.map((a, i) => (i === index ? { ...a, harnessFamily } : a)),
    );
  const addAlias = () => setAliases((prev) => [...prev, blankAlias()]);
  const removeAlias = (index: number) =>
    setAliases((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
    );

  const onSave = async () => {
    const cleanAliases = aliases
      .map((a) => ({ ...a, slug: a.slug.trim() }))
      .filter((a) => a.slug);
    const submittedSlug = (editing ? slug : slug || slugify(name)).trim();
    const input: ModelInput = {
      slug: submittedSlug,
      name: name.trim(),
      provider: provider.trim(),
      aliases: cleanAliases,
      openrouterSlug: openrouterSlug.trim() || null,
      description: description.trim() || null,
      logoSvg,
      providerLogoUrl: logoUrl.trim() || null,
    };
    setBusy(true);
    setError(null);
    try {
      const result = editing
        ? await config.updateModel(slug, input)
        : await config.createModel(input);
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
      !window.confirm(
        "Delete this model configuration? The model reverts to being derived " +
          "from its runs alone (its curated name, description, and logo are " +
          "removed). This cannot be undone.",
      )
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
          Could not seed from that run ({seedError}) — fill the fields in by hand.
        </p>
      )}

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

        <label className={styles.field}>
          <span className={styles.fieldLabel}>OpenRouter slug (for pricing)</span>
          <input
            className={styles.input}
            value={openrouterSlug}
            onChange={(e) => setOpenrouterSlug(e.target.value)}
            placeholder="e.g. anthropic/claude-opus-4.8"
          />
        </label>
      </div>

      {/* Aliases: the canonical model ids this entry claims, each paired with the
          harness family it is usable with — a repeatable list that always keeps at
          least one row. */}
      <div className={styles.aliasBlock}>
        <span className={styles.fieldLabel}>Model ids by harness family</span>
        <span className={styles.fieldHint}>
          Pair each model id with the harness family it works with — a Claude Code
          slug (e.g. <code>claude-opus-4-8</code>) under Claude Code, an OpenRouter
          slug (e.g. <code>anthropic/claude-opus-4.8</code>) under Others. The run
          form offers a harness only the slugs in its family.
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

      {error && (
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {error}
        </p>
      )}
    </PageLayout>
  );
}
