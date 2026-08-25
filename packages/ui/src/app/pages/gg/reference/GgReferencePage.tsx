import { useEffect, useState } from "react";
import type { GgProgramLanguage } from "@test-cabinet/run-record/gg";
import { NavLink } from "react-router";
import { LoadingState } from "../../../components/LoadingState";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";
import {
  useGgReference,
  useGgReferenceApi,
} from "../../../data/useGgReference";
import { routes } from "../../../routes";
import { GG_CHROME } from "../ggChrome";
import { GgReferenceApiTab } from "./GgReferenceApiTab";
import { GgReferenceToolsTab } from "./GgReferenceToolsTab";
import { isProgramLanguage } from "../programLanguages";
import { useArmSelection } from "./referenceSelection";
import styles from "./GgReference.module.scss";
import exec from "../../runs/RunExec.module.scss";

// The Reference surface: the header, the tab bar, the three states that are not a
// document, and whichever tab's body is asked for.
//
// **One component for both tabs, deliberately.** The tabs are two views of one surface,
// and the index — the families and the tools — is what both are read against, so the
// index fetch is owned here and a tab switch must be a re-render rather than a second
// request. That only holds if React sees the same component across the switch: two
// distinct route elements would be two component *types*, and reconciliation would unmount
// one subtree and mount the other, taking this component's `useGgReference()` with it and
// putting the loading line back on screen every time a reader flipped between a tool and
// its API counterpart — which is the one motion this page's two-tab shape exists to serve.
// So the router mounts `<GgReferencePage tab="tools" />` and `<GgReferencePage tab="api" />`
// against its two patterns, exactly the way the test-case catalog mounts one `TestCasesPage`
// against each of its type tabs.
//
// **Two fetches, because the reference is two documents.** The index is
// language-independent and is fetched here for both tabs; a program language's own
// responses-as-code surface is a document per arm, fetched when a reader is looking at
// one. `useGgReferenceApi(null)` while the Tools tab is open is what keeps a reader of the
// tool descriptions from pulling ninety kilobytes of Kotlin signatures they did not ask
// for, and the hook's own cache is what keeps flipping back to the API tab from
// re-fetching what it already has.
//
// The tabs are still two *routes* rather than a local toggle because which half of gg's
// surface you are reading is worth linking to on its own, and because the entry selected
// within a tab already rides in the query string: `?tool=` on one URL and `?fn=`/`?lang=`
// on another cannot collide, whereas one route carrying all three would have to decide
// what a URL naming each means.

interface GgReferencePageProps {
  /** Which half of gg's surface to render — the one the bar marks active. */
  tab: "tools" | "api";
}

export function GgReferencePage({ tab }: GgReferencePageProps) {
  const { data, loading, error } = useGgReference();
  const { requested: requestedArm, select: selectArm } = useArmSelection();

  // The arm the reader last picked, kept above the tabs so a flip to Tools and back does
  // not silently drop them onto whichever arm the index lists first. The address is still
  // the authority — a link that names an arm names it — but the tab bar's own link
  // carries no query, so without this the round trip would land somewhere else than it
  // left. Seeded from the address too, so a deep link is remembered the same way a click
  // is.
  const [remembered, setRemembered] = useState<GgProgramLanguage | null>(null);
  useEffect(() => {
    if (requestedArm != null && isProgramLanguage(requestedArm)) {
      setRemembered(requestedArm);
    }
  }, [requestedArm]);

  // Resolution, in the order the answers are owed: what the address says, then what the
  // reader last picked, then the first arm this deployment registers. An address naming
  // something that is not one of gg's languages at all, or one this deployment's gg does
  // not register, resolves to `null` on purpose — the tab says so rather than quietly
  // showing a different arm, for the same reason a `?tool=` naming a dropped tool does.
  const languages = data?.languages ?? [];
  const addressed =
    requestedArm != null && isProgramLanguage(requestedArm)
      ? requestedArm
      : null;
  const known = (candidate: GgProgramLanguage | null) =>
    candidate != null && languages.some((entry) => entry.id === candidate)
      ? candidate
      : null;
  const arm =
    requestedArm != null
      ? known(addressed)
      : (known(remembered) ?? languages[0]?.id ?? null);

  // Nothing is fetched for the Tools tab: its document is the index, which is already here.
  const armDocument = useGgReferenceApi(tab === "api" ? arm : null);

  return (
    // `fill` so the two-pane explorer inside can grow to the bottom of the page rather
    // than sitting in a short box with the sidebar scrolling inside it — the same
    // arrangement the run monitor's explorers get.
    <PageLayout fill chrome={GG_CHROME}>
      <PromptHeader
        command="--gg reference"
        comment={<>// what gg actually offers a model</>}
      />

      <nav className={styles.tabs} aria-label="Reference">
        <NavLink
          to={routes.ggReferenceTools()}
          className={
            tab === "tools" ? `${styles.tab} ${styles.tabActive}` : styles.tab
          }
        >
          Tools
        </NavLink>
        <NavLink
          to={routes.ggReferenceApi()}
          className={
            tab === "api" ? `${styles.tab} ${styles.tabActive}` : styles.tab
          }
        >
          API
        </NavLink>
      </nav>

      <div className={styles.body}>
        {error ? (
          // The backend's own message, not a paraphrase: a deployment whose reference
          // documents are missing answers with the two things that fix it, and this is
          // where whoever can fix it will read them.
          <p className={`${exec.notice} ${exec.error}`}>{error}</p>
        ) : loading ? (
          <LoadingState label="Loading gg's reference…" size="section" />
        ) : data ? (
          // Each tab's body takes the loaded index, so neither has to handle "no document
          // yet": the states above are this component's, once, for both.
          tab === "tools" ? (
            <GgReferenceToolsTab reference={data} />
          ) : (
            <GgReferenceApiTab
              index={data}
              languages={data.languages}
              language={arm}
              requestedLanguage={requestedArm}
              onSelectLanguage={(next) => {
                setRemembered(next);
                selectArm(next);
              }}
              arm={armDocument.data}
              loading={armDocument.loading}
              error={armDocument.error}
            />
          )
        ) : (
          // Not a failure: a host with no backend behind it (the read-only static site)
          // has nothing to ask, and a fetch that never happened must not read as one that
          // went wrong.
          <p className={styles.empty}>
            No backend to read the reference from — this surface needs a console
            pointed at a deployment.
          </p>
        )}
      </div>
    </PageLayout>
  );
}
