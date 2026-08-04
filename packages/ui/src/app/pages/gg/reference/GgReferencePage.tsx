import type { GgProgramLanguage } from "@test-cabinet/run-record/gg";
import { NavLink } from "react-router";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";
import { useGgReference } from "../../../data/useGgReference";
import { routes } from "../../../routes";
import { GG_CHROME } from "../ggChrome";
import { GgReferenceApiTab } from "./GgReferenceApiTab";
import { GgReferenceToolsTab } from "./GgReferenceToolsTab";
import styles from "./GgReference.module.scss";
import exec from "../../runs/RunExec.module.scss";

/**
 * How each [program language](GgProgramLanguage) is named to a reader.
 *
 * A `Record` over the union rather than a lookup with a fallback, so a language gg registers
 * without naming it here is a TypeScript error rather than a page that shows a wire id.
 */
const PROGRAM_LANGUAGE_NAMES: Record<GgProgramLanguage, string> = {
  typescript: "TypeScript",
};

// The Reference surface: the header, the sentence saying where the document came from, the
// tab bar, the three states that are not a document, and whichever tab's body is asked for.
//
// **One component for both tabs, deliberately.** The tabs are two views of one payload —
// the same `GET /gg/reference` response carries the categories, the tools and the functions
// — so the fetch is owned here and a tab switch must be a re-render rather than a second
// request. That only holds if React sees the same component across the switch: two distinct
// route elements would be two component *types*, and reconciliation would unmount one
// subtree and mount the other, taking this component's `useGgReference()` with it and
// putting the loading line back on screen every time a reader flipped between a tool and
// its API counterpart — which is the one motion this page's two-tab shape exists to serve.
// So the router mounts `<GgReferencePage tab="tools" />` and `<GgReferencePage tab="api" />`
// against its two patterns, exactly the way the test-case catalog mounts one `TestCasesPage`
// against each of its type tabs.
//
// The tabs are still two *routes* rather than a local toggle because which half of gg's
// surface you are reading is worth linking to on its own, and because the entry selected
// within a tab already rides in the query string: `?tool=` on one URL and `?fn=` on another
// cannot collide, whereas one route carrying both would have to decide what a URL naming
// each means.

interface GgReferencePageProps {
  /** Which half of gg's surface to render — the one the bar marks active. */
  tab: "tools" | "api";
}

export function GgReferencePage({ tab }: GgReferencePageProps) {
  const { data, loading, error } = useGgReference();

  return (
    // `fill` so the two-pane explorer inside can grow to the bottom of the page rather
    // than sitting in a short box with the sidebar scrolling inside it — the same
    // arrangement the run monitor's explorers get.
    <PageLayout fill chrome={GG_CHROME}>
      <PromptHeader
        command="--gg reference"
        comment={<>// what gg actually offers a model</>}
      />

      {/* Where the document comes from, said once. It matters because the page looks
          like documentation and is not: nothing on it was written for this page. */}
      <p className={styles.intro}>
        Every description, schema and signature below is projected from
        gg&apos;s own tool definitions and sandbox SDK — this is the text a
        model is given, verbatim, not a summary of it. It is served by the
        backend this console is pointed at, so it describes that
        deployment&apos;s gg rather than whatever version the console was built
        from.
        {data && (
          <>
            {" "}
            Projected from gg{" "}
            <span className={styles.version}>{data.ggVersion}</span>, with the
            API signatures spelled in{" "}
            <span className={styles.version}>
              {PROGRAM_LANGUAGE_NAMES[data.language] ?? data.language}
            </span>{" "}
            — gg&apos;s default program language. A run configured to another
            language offers the same functions under that language&apos;s own
            spellings.
          </>
        )}
      </p>

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

      {error ? (
        <p className={`${exec.notice} ${exec.error}`}>{error}</p>
      ) : loading ? (
        <p className={styles.empty}>Loading gg&apos;s reference…</p>
      ) : data ? (
        // Each tab's body takes the loaded document, so neither has to handle "no
        // document yet": the states above are this component's, once, for both.
        tab === "tools" ? (
          <GgReferenceToolsTab reference={data} />
        ) : (
          <GgReferenceApiTab reference={data} />
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
    </PageLayout>
  );
}
