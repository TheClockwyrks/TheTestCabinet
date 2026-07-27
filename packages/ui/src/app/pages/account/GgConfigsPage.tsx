import { useCallback, useState } from "react";
import { Link } from "react-router";
import type { GgConfig } from "@test-cabinet/run-record/gg";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import {
  builtInKey,
  savedKey,
  useGgConfigs,
  type GgConfigOption,
} from "../runs/gg/useGgConfigs";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// How many capabilities a configuration's Root agent turns on — the one-glance
// summary of what a configuration actually is. (Capabilities are per agent now; the
// Root is the run's headline profile.)
function enabledCount(option: GgConfigOption): number {
  return (option.capabilitySet.agents?.[0]?.capabilities ?? []).filter(
    (c) => c.enabled,
  ).length;
}

// The gg tab (`/account/gg`): the operator's registered gg configurations — named
// capability sets — plus the read-only built-ins everyone shares.
//
// gg is its own run mode: a run is configured by a capability set rather than a
// harness/model/orchestrator tuple, so the *configuration* is the reusable thing
// worth naming. Register one here and the New run page offers it in the harness
// slot once `gg` is chosen as the orchestrator. Console-only; the saved
// configurations are per-account, so managing them needs a signed-in operator
// (the built-ins are shown regardless).
export function GgConfigsPage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { saved, builtIns, loading, error, reload } = useGgConfigs();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const deleteConfig = useCallback(
    async (config: GgConfig) => {
      if (!backend?.deleteGgConfig || !token) return;
      if (
        !window.confirm(
          `Delete the gg configuration “${config.name}”? Runs already launched ` +
            `from it keep their own recorded capability set. This cannot be undone.`,
        )
      ) {
        return;
      }
      setBusy(true);
      setActionError(null);
      try {
        await backend.deleteGgConfig(config.id, token);
        await reload();
      } catch (e) {
        setActionError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, reload],
  );

  const renderBuiltIn = (option: GgConfigOption) => (
    <div key={option.key} className={styles.rowCard}>
      <div className={styles.rowMain}>
        <span className={styles.rowTitle}>{option.name}</span>
        <span className={styles.rowSub}>
          {option.description} · {enabledCount(option)} capabilities on
        </span>
      </div>
      <span className={styles.rowActions}>
        <Link
          className={exec.secondary}
          to={routes.accountGgConfigNew(builtInKey(option.name))}
        >
          Duplicate
        </Link>
      </span>
    </div>
  );

  const renderSaved = (config: GgConfig) => {
    const on = (config.capabilitySet.agents?.[0]?.capabilities ?? []).filter(
      (c) => c.enabled,
    ).length;
    return (
      <div key={config.id} className={styles.rowCard}>
        <div className={styles.rowMain}>
          <Link
            className={styles.rowTitleLink}
            to={routes.accountGgConfigEdit(config.id)}
          >
            {config.name}
          </Link>
          <span className={styles.rowSub}>
            {config.description ? `${config.description} · ` : ""}
            {on} capabilities on
          </span>
        </div>
        <span className={styles.rowActions}>
          <Link
            className={exec.secondary}
            to={routes.accountGgConfigEdit(config.id)}
          >
            Edit
          </Link>
          <Link
            className={exec.secondary}
            to={routes.accountGgConfigNew(savedKey(config.id))}
          >
            Duplicate
          </Link>
          <button
            type="button"
            className={exec.danger}
            disabled={busy}
            onClick={() => deleteConfig(config)}
          >
            Delete
          </button>
        </span>
      </div>
    );
  };

  return (
    <PageLayout>
      <div className={exec.runsHeader}>
        <PromptHeader
          command="--gg-configs"
          comment={<>// named capability sets to run gg with</>}
        />
        {token && (
          <Link className={exec.primary} to={routes.accountGgConfigNew()}>
            New configuration
          </Link>
        )}
      </div>
      <AccountTabs active="gg" />

      {(error || actionError) && (
        <p className={`${exec.notice} ${exec.error}`}>{error ?? actionError}</p>
      )}

      <p className={exec.sectionLabel}>Your configurations</p>
      {!token ? (
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to register your own gg configurations — they are saved to
          your account. The built-in configurations below are available to
          everyone.
        </p>
      ) : loading ? (
        <p className={styles.empty}>Loading configurations…</p>
      ) : saved.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            You have no gg configurations yet. Create one — or duplicate a
            built-in below and edit it — then pick it on the New run page after
            choosing <code>gg</code> as the orchestrator.
          </p>
          <Link className={exec.primary} to={routes.accountGgConfigNew()}>
            Create your first configuration
          </Link>
        </div>
      ) : (
        <div className={styles.list}>{saved.map(renderSaved)}</div>
      )}

      <p className={exec.sectionLabel}>Built-in configurations</p>
      <p className={styles.empty}>
        Shared and read-only — the standard arms of an ablation. Duplicate one
        to make it yours.
      </p>
      <div className={styles.list}>{builtIns.map(renderBuiltIn)}</div>
    </PageLayout>
  );
}
