import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { GgConfigInput } from "@test-cabinet/run-record/gg";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { BackChevron } from "../../components/BackChevron";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { routes } from "../../routes";
import { GgConfigEditor } from "../runs/gg/GgConfigEditor";
import { CAP_GROUPS, type CapGroup } from "../runs/gg/ggCatalog";
import {
  capabilitySetFromDraft,
  draftFromCapabilitySet,
  draftSaveError,
  emptyDraft,
  type GgConfigDraft,
} from "../runs/gg/ggConfigDraft";
import { builtInDraft } from "../runs/gg/useGgConfigs";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The gg configuration editor (`/account/gg/new` and `/account/gg/:configId/edit`):
// a configuration's name, its one-line purpose, and the capability set itself.
// Save creates or updates and returns to the gg tab.
//
// A configuration is deliberately test-case-free and need not bind a model: the New
// run page supplies the case and binds the primary slot from its own model picker,
// so one configuration serves a whole sweep. Console-only; gated on a signed-in
// account.
export function GgConfigEditPage() {
  const { configId } = useParams();
  const editing = Boolean(configId);
  const [params] = useSearchParams();
  // `?from=builtin:<name>` / `?from=saved:<id>` seeds a new configuration from an
  // existing one — how the list page's Duplicate action works.
  const from = params.get("from");
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const navigate = useNavigate();

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<GgConfigDraft>(() => emptyDraft());
  const [collapsed, setCollapsed] = useState<Set<CapGroup>>(
    () => new Set(CAP_GROUPS.filter((g) => !g.startOpen).map((g) => g.group)),
  );

  function toggleGroup(group: CapGroup) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    // A built-in seed needs no round-trip; everything else reads the account's
    // stored configurations (to load the one being edited, or the one duplicated).
    const seedBuiltIn = from?.startsWith("builtin:")
      ? builtInDraft(from.slice("builtin:".length))
      : null;
    if (seedBuiltIn) {
      setName(`${from!.slice("builtin:".length)} (copy)`);
      setDraft(seedBuiltIn);
      setLoading(false);
    } else if (!editing && !from) {
      setDraft(emptyDraft());
      setLoading(false);
    } else {
      Promise.resolve(backend.listGgConfigs?.(token) ?? [])
        .then((configs) => {
          if (!active) return;
          const wantedId = editing
            ? configId
            : from?.startsWith("saved:")
              ? from.slice("saved:".length)
              : undefined;
          const found = configs.find((c) => c.id === wantedId);
          if (!found) {
            setError("That configuration no longer exists.");
          } else {
            setName(editing ? found.name : `${found.name} (copy)`);
            setDescription(found.description);
            setDraft(draftFromCapabilitySet(found.capabilitySet));
          }
          setLoading(false);
        })
        .catch((e) => {
          if (!active) return;
          setError(String(e));
          setLoading(false);
        });
    }
    backend
      .listModels()
      .then((ms) => active && setModels(ms))
      .catch(() => {
        // The model catalog is optional; the slot pickers stay free-text.
      });
    return () => {
      active = false;
    };
  }, [backend, token, editing, configId, from]);

  const structuralError = draftSaveError(draft);
  const savable = name.trim().length > 0 && structuralError === null && !busy;

  async function onSave() {
    if (!token || !savable) return;
    const input: GgConfigInput = {
      name: name.trim(),
      description: description.trim(),
      // A saved configuration records its own name as the `preset` facet, so every
      // run launched from it is sliceable by which configuration produced it.
      capabilitySet: capabilitySetFromDraft(draft, name.trim()),
    };
    setBusy(true);
    setError(null);
    try {
      if (editing && configId && backend?.updateGgConfig) {
        await backend.updateGgConfig(configId, input, token);
      } else if (backend?.createGgConfig) {
        await backend.createGgConfig(input, token);
      }
      navigate(routes.accountGgConfigs());
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  const header = (
    <header className={styles.detailHeader}>
      <div className={styles.detailTitleRow}>
        <BackChevron
          to={routes.accountGgConfigs()}
          label="All gg configurations"
        />
        <h1 className={styles.detailTitle}>
          {editing ? name || "Configuration" : "New gg configuration"}
        </h1>
      </div>
    </header>
  );

  if (!token) {
    return (
      <PageLayout>
        {header}
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to edit gg configurations — they are saved to your account.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      {header}

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}

      {loading ? (
        <LoadingState label="Loading…" />
      ) : (
        <>
          <div className={exec.fields}>
            <label className={exec.field}>
              <span className={exec.fieldLabel}>Configuration name</span>
              <input
                className={exec.input}
                type="text"
                value={name}
                placeholder="e.g. no-compaction"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className={exec.field}>
              <span className={exec.fieldLabel}>Description (optional)</span>
              <input
                className={exec.input}
                type="text"
                value={description}
                placeholder="what this arm is for"
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </div>

          <GgConfigEditor
            value={draft}
            onChange={setDraft}
            models={models}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
          />

          <div className={exec.actions}>
            <div className={exec.actionsEnd}>
              {structuralError && (
                <span className={exec.muted}>{structuralError}</span>
              )}
              <button
                type="button"
                className={exec.primary}
                onClick={onSave}
                disabled={!savable}
              >
                {busy
                  ? "Saving…"
                  : editing
                    ? "Save configuration"
                    : "Create configuration"}
              </button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
