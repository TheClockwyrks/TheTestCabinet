import { useEffect, useMemo, useRef, useState } from "react";
import type { GgProgramLanguage } from "@test-cabinet/run-record/gg";
import type {
  GgReference,
  GgReferenceApi,
  GgReferenceCategory,
  GgReferenceEntry,
  GgReferenceLanguage,
  GgReferenceModule,
} from "@test-cabinet/run-record/gg-reference";
import {
  FsExplorer,
  FsFileRow,
  FsFolder,
  useFsFolders,
} from "../../runs/gg/GgFsExplorer";
import { fsIndent } from "../../runs/gg/ggFsTree";
import { PROGRAM_LANGUAGE_NAMES } from "../programLanguages";
import { Section, Verbatim } from "./GgReferenceParts";
import { useEntrySelection, useRevealSelection } from "./referenceSelection";
import panels from "../../runs/gg/GgPanels.module.scss";
import styles from "./GgReference.module.scss";
import exec from "../../runs/RunExec.module.scss";

// The **API** tab: one SDK arm's whole responses-as-code surface — every function a
// program can call and every type it can be handed — grouped by the capability module it
// lives in.
//
// # Why this tab has an arm picker and the Tools tab does not
//
// gg offers one set of capabilities through eleven SDKs, each deliberately written to
// read as its own language rather than as a transliteration of some other: what Rust
// spells `gg::files::read_file(path, files::ReadOptions::default())` PureScript spells
// with a record and Ruby with a block. A page that showed one of them would be
// documenting a tenth of gg's surface while looking complete — which is exactly what this
// page did while the reference was a single committed document projected from gg's
// default language. The tools are not like that: a tool's name and JSON schema are the
// *wire's*, identical whatever language a run's programs are written in, so they are in
// the index and have no arm to pick.
//
// # What is on the page, and what is deliberately not
//
// This is the **maximal reachable pool**: every function gg offers on this arm. It is not
// one run's view. What a particular agent was actually offered is a different question,
// answered by that instance's agent-surface record on the run itself — and a page trying
// to answer both would answer neither.
//
// # One renderer, not two
//
// Each entry's body is the string gg's own documentation runtime produces for that name —
// the same bytes a program gets back from a documentation lookup mid-session, fetched as
// text and rendered as text. The console does not re-render a structured signature record
// beside it, because two renderers over one input is the second source of truth this
// surface exists to not have. The structured fields that remain are *navigation*: what to
// file the entry under, what to link to, what to filter by.
//
// The join between a folder and its entries is gg's module **id**, never the path: the
// path is one arm's spelling (`gg.files` here, `gg::files` there) and grouping by it would
// silently empty every folder the moment a reader picked another arm.
//
// This is the tab's *body*, not a page: the frame around it — the header, the tab bar and
// the index both tabs read from — is `GgReferencePage`'s, and lives above the two so
// switching tabs does not throw the documents away. See `GgReferencePage.tsx`.

/** One module's folder in the sidebar: the module, the family it came from, its entries. */
interface ModuleGroup {
  module: GgReferenceModule;
  category: GgReferenceCategory | null;
  entries: GgReferenceEntry[];
}

/**
 * What a reader was looking at when they switched arms, in the terms that survive the
 * switch.
 *
 * The fully-qualified name does not survive it — that is the entire point of eleven
 * idiomatic arms — so carrying the selection over has to be done in some vocabulary both
 * documents share. See {@link findCounterpart}.
 */
interface EntryIdentity {
  /** gg's own operation id, which is the same in all eleven arms. Absent for a type. */
  operation: string | null;
  /** The module's cross-arm id, which is also the same in all eleven. */
  module: string;
  /** The entry's own name on the arm being left, for a type, which has no operation. */
  name: string;
  /** Whether the reader was on the member-function alias rather than the free function. */
  alias: boolean;
}

export function GgReferenceApiTab({
  index,
  languages,
  language,
  requestedLanguage,
  onSelectLanguage,
  arm,
  loading,
  error,
}: {
  /** The reference index — read here for the families the entries name. */
  index: GgReference;
  /** Every arm this deployment can serve a document for, as the picker lists them. */
  languages: GgReferenceLanguage[];
  /** The arm being shown, or `null` when the address names one gg does not register. */
  language: GgProgramLanguage | null;
  /** The raw `?lang=`, so an unrecognised one can be quoted back rather than ignored. */
  requestedLanguage: string | null;
  /** Pick an arm: writes the address and remembers the pick across a tab flip. */
  onSelectLanguage: (language: GgProgramLanguage) => void;
  /** The picked arm's document, or `null` while it is loading or has failed. */
  arm: GgReferenceApi | null;
  loading: boolean;
  /** The arm fetch's failure, verbatim — the backend writes it to be read. */
  error: string | null;
}) {
  const folders = useFsFolders();
  const { requested, select } = useEntrySelection("fn");
  const [filter, setFilter] = useState("");
  // The entry the reader was on when they last picked a different arm. A ref rather than
  // state because nothing renders it: it is consumed once, by the first resolution that
  // happens after the new arm's document arrives.
  const carried = useRef<EntryIdentity | null>(null);

  const entries = useMemo(() => arm?.entries ?? [], [arm]);

  // Modules in the order the document presents them, which is the order a model meets
  // them in its own system prompt, each holding the entries that named it — functions
  // first and then the types declared beside them, which is the document's own order.
  //
  // Two walks of it, and the difference matters. `groups` is what the **tree** draws and is
  // filtered; `ordered` is the same walk unfiltered, and is what decides where the pane
  // opens. Deriving the opening entry from the filtered walk instead would make typing in
  // the filter box change what the pane is showing, and empty it entirely at the moment
  // the needle matches nothing — so a reader looking something up would lose the entry
  // they were reading as a side effect of looking.
  const ordered = useMemo<GgReferenceEntry[]>(
    () =>
      (arm?.modules ?? []).flatMap((module) =>
        entries.filter((entry) => entry.module === module.id),
      ),
    [arm, entries],
  );

  // Empty groups are dropped, which under a filter is most of them and under no filter is
  // none of them: every module carries at least a type, including the types-only module
  // every arm has for the declarations that belong to no capability.
  const groups = useMemo<ModuleGroup[]>(() => {
    const needle = filter.trim().toLowerCase();
    const matches = (entry: GgReferenceEntry) =>
      needle === "" ||
      // The body too, not only the names: what a reader half-remembers about a call is
      // as often a phrase from its description ("passed by name", "fails if you are
      // already at the maximum depth") as its spelling.
      `${entry.fqn}\n${entry.name}\n${entry.brief}\n${entry.body}`
        .toLowerCase()
        .includes(needle);
    return (arm?.modules ?? [])
      .map((module) => ({
        module,
        category:
          index.categories.find(
            (category) => category.id === module.category,
          ) ?? null,
        entries: entries.filter(
          (entry) => entry.module === module.id && matches(entry),
        ),
      }))
      .filter((group) => group.entries.length > 0);
  }, [arm, entries, filter, index.categories]);

  // With no `?fn=`, the pane opens on the first row of the **tree** — not on
  // `entries[0]`. The document is in catalogue order, whose first module is not the first
  // folder on every arm, so the first entry of the array can sit several folders down a
  // sidebar that scrolls: the pane would open on something the reader cannot see is
  // selected, and the tree would look as though nothing were. `ordered` is the same walk
  // the sidebar does, so the highlight is always its first row.
  //
  // An address that names an entry this arm does not carry resolves to the counterpart
  // the reader carried over from the arm they left, and to nothing at all when there is
  // none — which is a real answer and says so. See `findCounterpart`.
  const exact =
    requested == null
      ? null
      : (entries.find((entry) => entry.fqn === requested) ?? null);
  const counterpart =
    requested != null && exact == null && carried.current != null
      ? findCounterpart(entries, carried.current)
      : null;
  const selected =
    requested == null ? (ordered[0] ?? null) : (exact ?? counterpart);

  // Carrying over rewrites the address, so the link in the bar names the entry the pane
  // is showing. Without this the address would still hold the arm-just-left's spelling,
  // and pasting it somewhere would reproduce a lookup that fails — the carry-over lives
  // in this component's memory and a fresh page load has none of it.
  //
  // The carry is cleared **here and nowhere else on this path**, and that is load-bearing.
  // Picking an arm changes the address before the new document arrives, so there is a
  // render — usually several — in which the address already names the new arm while
  // `entries` is still the old arm's, and the old arm of course resolves its own name
  // exactly. Clearing the carry on any exact match would therefore throw it away in that
  // window, and the carry-over would work only between arms that spell the call the same
  // way (TypeScript and JavaScript, and no other pair) — which looks like it works.
  useEffect(() => {
    if (selected == null || requested == null || selected.fqn === requested) {
      return;
    }
    carried.current = null;
    select(selected.fqn);
  }, [requested, select, selected]);

  // Opening an entry from the tree or from a type link is a *deliberate* selection, so it
  // retires whatever the last arm switch left behind: without this a carry that was never
  // consumed (because the arm switched to happened to spell the call identically) would
  // still be sitting there to answer a later address that names nothing, and would land
  // the reader on the wrong entry instead of saying the name is not there.
  const openEntry = (fqn: string) => {
    carried.current = null;
    select(fqn);
  };

  // A dozen folders of entries scroll well past the fold, so a link to a session call
  // would otherwise open beside a tree still showing the filesystem module.
  useRevealSelection(requested != null, selected != null);

  const pick = (next: GgProgramLanguage) => {
    if (next === language) return;
    // Remember where the reader was *before* the document under them changes, so the
    // arm they switch to opens on the same call rather than back at the top. This is the
    // motion the picker exists for: the same operation, spelled two ways, compared.
    carried.current = selected
      ? {
          operation: selected.operation ?? null,
          module: selected.module,
          name: selected.name,
          alias: selected.aliasOf != null,
        }
      : null;
    onSelectLanguage(next);
  };

  return (
    <div className={styles.arm}>
      <ArmPicker languages={languages} selected={language} onSelect={pick} />

      {error ? (
        // The backend's own sentence, not ours: a deployment with no reference documents
        // answers with a message naming the script that writes them and the variable that
        // points at them, and paraphrasing it here would drop the one thing that fixes it.
        <p className={`${exec.notice} ${exec.error}`}>{error}</p>
      ) : language == null ? (
        <p className={styles.empty}>
          {requestedLanguage ? (
            <>
              gg {index.ggVersion} registers no program language called{" "}
              <code>{requestedLanguage}</code>. Pick one of the{" "}
              {languages.length} arms above.
            </>
          ) : (
            <>
              This deployment&apos;s gg registers no program language, so there
              is no responses-as-code surface to show.
            </>
          )}
        </p>
      ) : loading || arm == null ? (
        <p className={styles.empty}>
          Loading the {PROGRAM_LANGUAGE_NAMES[language]} surface…
        </p>
      ) : arm.entries.length === 0 ? (
        // A third state between "loading" and "a tree", because a document that decodes
        // and carries nothing is served `200` and would otherwise render as a tree with
        // no rows — which reads as a filter that matched nothing, with an empty filter
        // box beside it. There is no such thing as a legitimately empty arm: every
        // registered one carries at least the types-only module. So this says what it
        // really is, a broken projection in *this deployment*, rather than letting the
        // reader conclude their own search was at fault. The backend logs the same fact
        // when it loads the document.
        <p className={styles.empty}>
          This deployment&apos;s document for the{" "}
          {PROGRAM_LANGUAGE_NAMES[language]} arm of gg {arm.ggVersion} is empty.
          That is a broken projection rather than an arm gg does not have — the
          documents are written by <code>gg reference --out</code> and read from
          the directory <code>TCAB_GG_REFERENCE</code> names.
        </p>
      ) : (
        <FsExplorer
          sidebarLabel="API modules"
          sidebarHead={
            <div className={styles.filter}>
              <input
                className={styles.filterInput}
                type="search"
                value={filter}
                placeholder="Filter this arm…"
                aria-label="Filter this arm's surface"
                onChange={(event) => setFilter(event.target.value)}
              />
              {/* Said once, because the two are easy to confuse and the difference is
                  the whole shape of this page. gg's own `search` ranks its hits and
                  returns only what a run granted; this box hides rows of the maximal
                  pool and reorders nothing. Reimplementing the ranking here would be a
                  frozen copy of an algorithm that lives in gg — the second source of
                  truth again — and it would answer a different question anyway.

                  The needle survives an arm switch, deliberately: a phrase from a
                  description ("compaction") means the same thing on every arm, and
                  silently emptying the box would be a second surprise on top of the
                  document changing. A needle that was a *spelling* will match nothing
                  on the next arm — and the tree says so, with the needle still visible
                  in the box that caused it. */}
              <p className={styles.filterNote}>
                Hides rows here. gg&apos;s own documentation search ranks its
                hits and returns only what a run granted; this page is the whole
                pool.
              </p>
            </div>
          }
          tree={
            groups.length === 0 ? (
              // In the sidebar, where the reader is looking, rather than under the
              // explorer: the empty thing is the tree, and a note somewhere else on the
              // page would leave the tree reading as broken rather than as filtered.
              <li className={styles.objectCaption} style={fsIndent(1)}>
                Nothing on this arm matches that.
              </li>
            ) : (
              groups.map((group) => (
                <FsFolder
                  key={group.module.id}
                  depth={0}
                  // Open by default, like the Tools tree: this is a fixed document read by
                  // scanning, not a live stream that needs collapsing.
                  open={folders.isOpen(group.module.id, true)}
                  onToggle={() => folders.toggle(group.module.id, true)}
                  ariaLabel={`${group.module.path} entries`}
                  name={group.module.path}
                  meta={
                    <span className={panels.fsMeta}>
                      {group.entries.length}
                    </span>
                  }
                >
                  {/* The module's own line, as the folder's first child rather than as a
                      second line in its row — see `.objectCaption`. `fsIndent(1)` is the same
                      inline indent the rows below take, which is what puts it in their column
                      instead of against the sidebar's edge.

                      The module's summary rather than its family's description: the family is
                      a grouping of gg's, and what a reader picking a folder wants is the
                      sentence the module itself is introduced by — the same one the model is
                      given. */}
                  <li className={styles.objectCaption} style={fsIndent(1)}>
                    {group.module.summary}
                  </li>
                  {group.entries.map((entry) => (
                    <FsFileRow
                      key={entry.fqn}
                      depth={1}
                      selected={selected?.fqn === entry.fqn}
                      onSelect={() => openEntry(entry.fqn)}
                      ariaLabel={`${entry.kind} ${entry.fqn}`}
                      name={entry.name}
                      // Only the declarations are marked. Functions are what a reader comes
                      // for and are the majority of every folder, so a badge on those would
                      // be a badge on nearly every row; the types are the ones a reader is
                      // surprised to find in a list of calls.
                      meta={
                        entry.kind === "type" ? (
                          <span className={panels.fsMeta}>type</span>
                        ) : undefined
                      }
                    />
                  ))}
                </FsFolder>
              ))
            )
          }
        >
          {selected ? (
            <EntryDetail
              entry={selected}
              arm={arm}
              category={
                index.categories.find(
                  (category) => category.id === selected.category,
                ) ?? null
              }
              module={
                arm.modules.find((module) => module.id === selected.module) ??
                null
              }
              onSelect={openEntry}
            />
          ) : (
            <div className={panels.panelBody}>
              {/* Guarded on `requested`, because this sentence is only ever true of a
                  name the *address* supplied. With no `?fn=` the pane opens on the
                  tree's first row and this branch is unreachable — unless the document
                  is malformed in a way that leaves entries filed under modules it does
                  not declare, and then quoting a name the reader never typed ("carries
                  nothing called .") would blame them for it. */}
              <p className={styles.empty}>
                {requested != null ? (
                  <>
                    The {PROGRAM_LANGUAGE_NAMES[language]} arm of gg{" "}
                    {arm.ggVersion} carries nothing called{" "}
                    <code>{requested}</code>. The eleven SDKs are idiomatic
                    rather than transliterations, so a name one arm spells this
                    way another may spell differently — or may not declare at
                    all. Pick one from the list.
                  </>
                ) : (
                  <>
                    Nothing on the {PROGRAM_LANGUAGE_NAMES[language]} arm of gg{" "}
                    {arm.ggVersion} could be opened: its entries name modules the
                    document does not declare. That is a broken projection —
                    the documents are written by <code>gg reference --out</code>
                    .
                  </>
                )}
              </p>
            </div>
          )}
        </FsExplorer>
      )}
    </div>
  );
}

/**
 * The arm picker: every program language this deployment can serve, all at once.
 *
 * All eleven rather than a dropdown, because this row is the only place on the console
 * where the breadth of the surface is visible — a reader who does not know gg has a Swift
 * arm will not think to open a menu looking for one.
 *
 * Each carries its own function count, and every arm listed is one the deployment can
 * actually serve: the backend rebuilds the index's language list from the documents it
 * loaded, counting each one, so a button here is never a button whose only answer is a
 * `404` and a number here is never a number nobody counted. An arm gg registers whose
 * document did not ship is therefore *absent* from this row rather than present and
 * broken — which is why the row's length is worth reading.
 */
function ArmPicker({
  languages,
  selected,
  onSelect,
}: {
  languages: GgReferenceLanguage[];
  selected: GgProgramLanguage | null;
  onSelect: (language: GgProgramLanguage) => void;
}) {
  return (
    <div className={styles.arms} role="group" aria-label="SDK arm">
      {languages.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className={
            entry.id === selected
              ? `${styles.armButton} ${styles.armButtonActive}`
              : styles.armButton
          }
          aria-pressed={entry.id === selected}
          // The bare number on the chip is the count a reader compares arms by; what it
          // counts, and the other two the index carries, are here rather than on the chip
          // because eleven chips each carrying three figures is a wall of numbers.
          title={`${entry.functionCount} functions, ${entry.typeCount} types, across ${entry.moduleCount} modules`}
          onClick={() => onSelect(entry.id)}
        >
          {PROGRAM_LANGUAGE_NAMES[entry.id]}
          <span className={styles.armCount}>{entry.functionCount}</span>
        </button>
      ))}
    </div>
  );
}

// One entry: what it is and what binds it, the documentation view gg renders for it, and
// the declarations its signature reaches.
function EntryDetail({
  entry,
  arm,
  category,
  module,
  onSelect,
}: {
  entry: GgReferenceEntry;
  /** The whole arm, for resolving the type names beside the body to their own entries. */
  arm: GgReferenceApi;
  /** The entry's family, or `null` for one that belongs to none. */
  category: GgReferenceCategory | null;
  /** The module it lives in, or `null` if the document names one it does not carry. */
  module: GgReferenceModule | null;
  /** Open another entry of this same arm, by its fully-qualified name. */
  onSelect: (fqn: string) => void;
}) {
  // The arm's own spelling of the call that opens a documentation view, found by the
  // operation id — the one identifier that is the same on all eleven arms. Naming the
  // reader's own arm's spelling is the point: the sentence below claims this block is
  // what *that* call returns, so it should quote the call as this arm writes it.
  const lookup =
    arm.entries.find((other) => other.operation === "views.open_docs_view") ??
    null;

  return (
    <div className={panels.panelBody}>
      <div className={styles.detail}>
        <header className={styles.detailHead}>
          <h2 className={styles.detailTitle}>{entry.fqn}</h2>
          <div className={styles.meta}>
            <span className={styles.chip}>
              {category?.title ?? entry.category ?? "No family"}
            </span>
            {/* A declaration rather than a call, marked, because everything else on this
                page is something a program invokes. */}
            {entry.kind === "type" && <span className={styles.chip}>type</span>}
            {/* gg's own name for what this call DOES, which is the one thing about it
                that is the same in all eleven arms — and the string a run's records name
                it by, so a reader who has this page open and a run's calls in front of
                them is looking at the same identifier in both. */}
            {entry.operation && (
              <span className={`${styles.chip} ${styles.chipKey}`}>
                {entry.operation}
              </span>
            )}
            {/* A convenience this arm hangs off the value it operates on, beside the free
                function every arm has. A fact about the arm, not about gg — which is what
                eleven idiomatic SDKs means in practice. */}
            {entry.receiver && (
              <span className={styles.chip}>on {entry.receiver}</span>
            )}
            {entry.aliasOf && (
              <span className={styles.chip}>second way to {entry.aliasOf}</span>
            )}
            {/* The line a program writes to reach the module, where the arm needs one.
                Ten of eleven arms put the SDK in scope already and carry none. */}
            {module?.import && (
              <span className={styles.chip}>{module.import}</span>
            )}
            {/* What binds the call, in the one vocabulary that actually decides it. Most
                functions are bound by a *tool* being enabled — responses as code is the
                same surface as the toolset, reached differently — while the ending call
                is bound by the agent's role and a few calls by a capability, which is why
                three separate fields exist rather than one "gate" string. */}
            {entry.gate && (
              <span className={`${styles.chip} ${styles.chipKey}`}>
                bound by {entry.gate}
              </span>
            )}
            {entry.ending && (
              <span className={`${styles.chip} ${styles.chipKey}`}>
                {entry.ending} ending
              </span>
            )}
            {entry.capability && (
              <span className={`${styles.chip} ${styles.chipKey}`}>
                bought by {entry.capability}
              </span>
            )}
            {/* Nothing gates a view function: every program gets them whatever a run
                enables, and saying so is more useful than an empty metadata row. This is
                an affirmative claim, so it is guarded on every field that can withhold a
                call — a tool, a role, and a capability — and it is not made about a type,
                which is a declaration and is not withheld from anybody. */}
            {entry.kind === "function" &&
              !entry.gate &&
              !entry.ending &&
              !entry.capability && (
                <span className={styles.chip}>always available</span>
              )}
          </div>
          {/* Where the block below came from, said on every entry. It is the difference
              between a page that documents gg and a page that *is* gg's documentation,
              and a reader who does not know which one they are on cannot use either. */}
          <p className={styles.note}>
            Below is the documentation view gg renders for this name — the same
            bytes a program is handed by{" "}
            <code>
              {lookup ? lookup.fqn : "the documentation-view call"}(&quot;
              {entry.fqn}&quot;)
            </code>{" "}
            mid-session, not a rendering of it made for this page.
          </p>
        </header>

        <Verbatim label="Documentation view" text={entry.body} />

        <TypeReferences entry={entry} arm={arm} onSelect={onSelect} />
      </div>
    </div>
  );
}

/**
 * The declarations a function's signature reaches, each linked to its own entry — and,
 * for each, whether opening this function opens it too.
 *
 * Names rather than declarations. The old single-arm document expanded every referenced
 * declaration into every function that mentioned it, which is what made one arm's document
 * four times the size of all eleven of these; the type's own entry is in this same
 * document, so the page links to it instead.
 *
 * The two "opens" columns are gg's own answer, computed by the function a run calls,
 * rather than the guess a reader would otherwise make from the list: opening a function
 * appends type views exactly **one** level deep and only for the mode the agent's
 * documentation view is configured in, while this list is the transitive closure. The
 * page shows both sets, so there is no discrepancy to explain in prose.
 */
function TypeReferences({
  entry,
  arm,
  onSelect,
}: {
  entry: GgReferenceEntry;
  arm: GgReferenceApi;
  onSelect: (fqn: string) => void;
}) {
  const rows = useMemo(() => {
    const opensDefault = new Set(entry.opensUnderReturn ?? []);
    const opensAll = new Set(entry.opensUnderReturnAndParameters ?? []);
    const returned = new Set(entry.returns ?? []);
    // The closure first, in the document's own order, then anything the opens/returns
    // sets name that it does not — which is nothing today on any of the eleven arms, and
    // is here so that if it ever happens the page under-reports nothing rather than
    // silently dropping a name gg computed.
    const ordered = [
      ...(entry.types ?? []),
      ...[...returned, ...opensAll, ...opensDefault].filter(
        (fqn) => !(entry.types ?? []).includes(fqn),
      ),
    ];
    const seen = new Set<string>();
    return ordered
      .filter((fqn) => (seen.has(fqn) ? false : (seen.add(fqn), true)))
      .map((fqn) => ({
        fqn,
        // A name with no entry renders as text, not as a link to nothing. Every arm
        // resolves every one of them today; a page that fabricated a link would be
        // lying about a document it can see it does not have.
        known: arm.entries.some((other) => other.fqn === fqn),
        returned: returned.has(fqn),
        opensDefault: opensDefault.has(fqn),
        opensAll: opensAll.has(fqn),
      }));
  }, [arm.entries, entry]);

  if (rows.length === 0) return null;

  return (
    <Section label="Types this signature reaches">
      <p className={styles.note}>
        Every declaration the signature reaches, <em>transitively closed</em>.
        Opening this function mid-session appends type views exactly{" "}
        <em>one</em> level deep, and only those the agent&rsquo;s
        documentation-view mode selects — which of these those are is marked on
        each row.
      </p>
      <ul className={styles.typeRefs}>
        {rows.map((row) => (
          <li key={row.fqn} className={styles.typeRef}>
            {row.known ? (
              <button
                type="button"
                className={styles.typeRefLink}
                onClick={() => onSelect(row.fqn)}
              >
                {row.fqn}
              </button>
            ) : (
              <span className={styles.typeRefName}>{row.fqn}</span>
            )}
            {row.returned && <span className={styles.chip}>returned</span>}
            {row.opensDefault && (
              <span className={`${styles.chip} ${styles.chipKey}`}>
                opens under return
              </span>
            )}
            {row.opensAll && (
              <span className={styles.chip}>
                opens under return-and-parameters
              </span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * The entry on this arm that answers to the one a reader was reading on another.
 *
 * A **function** is found by gg's operation id, which is the same in all eleven arms and
 * is exactly the identity the fully-qualified name is not. An arm may bind one operation
 * twice — the free function every arm has, and a convenience method hung off the value it
 * operates on — so the alias-ness of the entry being left breaks that tie, and a reader
 * on `IssueCreated.wait` lands on the other arm's method rather than on its free
 * `wait_for_issue`.
 *
 * A **type** has no operation, so it is found by its module and its own name, folded to
 * ignore how the arm spells identifiers — `DirEntry` and `dir_entry` are the same
 * declaration written by two SDKs with different house styles. This is a heuristic and it
 * is allowed to fail: the arms declare genuinely different sets of types (one needs an
 * options record where another takes named arguments), and an arm that has no counterpart
 * says so rather than landing the reader somewhere plausible and wrong.
 */
function findCounterpart(
  entries: GgReferenceEntry[],
  identity: EntryIdentity,
): GgReferenceEntry | null {
  if (identity.operation != null) {
    const bound = entries.filter(
      (entry) => entry.operation === identity.operation,
    );
    return (
      bound.find((entry) => (entry.aliasOf != null) === identity.alias) ??
      bound[0] ??
      null
    );
  }
  const folded = foldIdentifier(identity.name);
  return (
    entries.find(
      (entry) =>
        entry.module === identity.module &&
        foldIdentifier(entry.name) === folded,
    ) ?? null
  );
}

/**
 * An identifier with its house style removed: lower-cased, with the separators an SDK
 * chooses between (`_`, `-`, `.`) dropped.
 *
 * `DirEntry`, `dir_entry` and `direntry` fold together, which is what lets a type carry
 * over between an arm that names declarations in Pascal case and one that names them in
 * snake case. It is not a general identifier normalizer and does not need to be — it is
 * used for one comparison, within one module, between two spellings of one declaration.
 */
function foldIdentifier(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, "");
}
