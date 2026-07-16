import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { CoverageGroup } from "@test-cabinet/run-record/coverage";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The Groups tab (`/account/groups`): the reusable model groups (sets of harness/
// model combinations) and case groups (sets of version-pinned cases) that coverage
// plans reference as pointers. Editing a group reshapes every plan that references
// it. Console-only; gated on a signed-in account.
export function GroupsPage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();

  const [groups, setGroups] = useState<CoverageGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!backend?.listCoverageGroups || !token) return;
    setGroups(await backend.listCoverageGroups(token));
  }, [backend, token]);

  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    Promise.resolve(backend.listCoverageGroups?.(token) ?? [])
      .then((g) => {
        if (!active) return;
        setGroups(g);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [backend, token]);

  const deleteGroup = useCallback(
    async (group: CoverageGroup) => {
      if (!backend?.deleteCoverageGroup || !token) return;
      if (
        !window.confirm(
          `Delete the group “${group.name}”? Plans that reference it will simply ` +
            `drop it. This cannot be undone.`,
        )
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await backend.deleteCoverageGroup(group.id, token);
        await reload();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, reload],
  );

  if (!token) {
    return (
      <PageLayout>
        <AccountTabs active="groups" />
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to manage coverage groups — they are saved to your account.
        </p>
      </PageLayout>
    );
  }

  const modelGroups = groups?.filter((g) => g.kind === "combo") ?? [];
  const caseGroups = groups?.filter((g) => g.kind === "case") ?? [];

  const renderGroup = (group: CoverageGroup) => {
    const count = group.kind === "combo" ? group.combos.length : group.cases.length;
    return (
      <div key={group.id} className={styles.rowCard}>
        <div className={styles.rowMain}>
          <span className={styles.rowTitle}>{group.name}</span>
          <span className={styles.rowSub}>
            {count} {group.kind === "combo" ? "combinations" : "cases"}
          </span>
        </div>
        <span className={styles.rowActions}>
          <Link
            className={exec.secondary}
            to={routes.accountGroupEdit(group.id)}
          >
            Edit
          </Link>
          <button
            type="button"
            className={exec.danger}
            disabled={busy}
            onClick={() => deleteGroup(group)}
          >
            Delete
          </button>
        </span>
      </div>
    );
  };

  return (
    <PageLayout>
      <AccountTabs active="groups" />
      <div className={exec.runsHeader}>
        <PromptHeader
          command="--account/groups"
          comment={<>// reusable model &amp; case groups</>}
        />
        <Link className={exec.primary} to={routes.accountGroupNew()}>
          New group
        </Link>
      </div>

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}

      {loading ? (
        <p className={styles.empty}>Loading groups…</p>
      ) : (groups?.length ?? 0) === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            You have no groups yet. Create a model group (a reusable set of
            harness/model combinations) or a case group (a reusable set of
            version-pinned cases), then reference them from your coverage plans.
          </p>
          <Link className={exec.primary} to={routes.accountGroupNew()}>
            Create your first group
          </Link>
        </div>
      ) : (
        <>
          <p className={exec.sectionLabel}>Model groups</p>
          {modelGroups.length === 0 ? (
            <p className={styles.empty}>No model groups yet.</p>
          ) : (
            <div className={styles.list}>{modelGroups.map(renderGroup)}</div>
          )}

          <p className={exec.sectionLabel}>Case groups</p>
          {caseGroups.length === 0 ? (
            <p className={styles.empty}>No case groups yet.</p>
          ) : (
            <div className={styles.list}>{caseGroups.map(renderGroup)}</div>
          )}
        </>
      )}
    </PageLayout>
  );
}
