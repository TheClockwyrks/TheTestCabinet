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
import { LoadingState } from "../../../components/LoadingState";
import { FsFileRow, FsFolder, useFsFolders } from "../../runs/gg/GgFsExplorer";
import { fsIndent } from "../../runs/gg/ggFsTree";
import { PROGRAM_LANGUAGE_NAMES, isProgramLanguage } from "../programLanguages";
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

/** One module's folder in the sidebar: the module, and the entries that named it. */
interface ModuleGroup {
  module: GgReferenceModule;
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
        entries: entries.filter(
          (entry) => entry.module === module.id && matches(entry),
        ),
      }))
      .filter((group) => group.entries.length > 0);
  }, [arm, entries, filter]);

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

  // Whether there is a tree to draw at all. Every state that is not a document — the
  // fetch failed, the address names no arm, the document is still loading, the document
  // decodes hollow — renders its message in the detail pane instead, beside the picker
  // that is the way out of most of them.
  const ready =
    error == null &&
    language != null &&
    !loading &&
    arm != null &&
    arm.entries.length > 0;

  return (
    <div className={styles.armExplorer}>
      {/* The left column: the arm picker, then the sidebar whose contents it decides.
          The picker shares the sidebar's width rather than taking a full row of its
          own, so the detail pane starts level with it and runs down to the same bottom
          edge the sidebar stops at. */}
      <div className={styles.armSide}>
        <ArmSelect languages={languages} selected={language} onSelect={pick} />
        {ready && (
          <nav className={styles.sidebar} aria-label="API modules">
            {/* The filter leads the sidebar and stays put: the entry list below it is
                the scroll container, so the box never scrolls away from its own
                results and no row ever slides underneath it. */}
            <div className={styles.filter}>
              <input
                className={styles.filterInput}
                type="search"
                value={filter}
                placeholder="Filter this arm…"
                aria-label="Filter this arm's surface"
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <div className={styles.entries}>
              <ul className={panels.fsTree}>
                {groups.length === 0 ? (
                  // In the sidebar, where the reader is looking, rather than under the
                  // explorer: the empty thing is the tree, and a note somewhere else on
                  // the page would leave the tree reading as broken rather than as
                  // filtered.
                  <li className={styles.objectCaption} style={fsIndent(1)}>
                    Nothing on this arm matches that.
                  </li>
                ) : (
                  groups.map((group) => (
                    <FsFolder
                      key={group.module.id}
                      depth={0}
                      // Open by default, like the Tools tree: this is a fixed document
                      // read by scanning, not a live stream that needs collapsing.
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
                      {group.entries.map((entry) => (
                        <FsFileRow
                          key={entry.fqn}
                          depth={1}
                          selected={selected?.fqn === entry.fqn}
                          onSelect={() => openEntry(entry.fqn)}
                          ariaLabel={`${entry.kind} ${entry.fqn}`}
                          name={entry.name}
                          // Only the declarations are marked. Functions are what a
                          // reader comes for and are the majority of every folder, so a
                          // badge on those would be a badge on nearly every row; the
                          // types are the ones a reader is surprised to find in a list
                          // of calls.
                          meta={
                            entry.kind === "type" ? (
                              <span className={panels.fsMeta}>type</span>
                            ) : undefined
                          }
                        />
                      ))}
                    </FsFolder>
                  ))
                )}
              </ul>
            </div>
          </nav>
        )}
      </div>

      <div className={styles.armDetail}>
        {error ? (
          // The backend's own sentence, not ours: a deployment with no reference
          // documents answers with a message naming the script that writes them and the
          // variable that points at them, and paraphrasing it here would drop the one
          // thing that fixes it.
          <p className={`${exec.notice} ${exec.error}`}>{error}</p>
        ) : language == null ? (
          <p className={styles.empty}>
            {requestedLanguage ? (
              <>
                gg {index.ggVersion} registers no program language called{" "}
                <code>{requestedLanguage}</code>. Pick one of the{" "}
                {languages.length} arms from the picker.
              </>
            ) : (
              <>
                This deployment&apos;s gg registers no program language, so
                there is no responses-as-code surface to show.
              </>
            )}
          </p>
        ) : loading || arm == null ? (
          <LoadingState
            label={`Loading the ${PROGRAM_LANGUAGE_NAMES[language]} surface…`}
            size="section"
          />
        ) : arm.entries.length === 0 ? (
          // A third state between "loading" and "a tree", because a document that
          // decodes and carries nothing is served `200` and would otherwise render as a
          // tree with no rows — which reads as a filter that matched nothing, with an
          // empty filter box beside it. There is no such thing as a legitimately empty
          // arm: every registered one carries at least the types-only module. So this
          // says what it really is, a broken projection in *this deployment*, rather
          // than letting the reader conclude their own search was at fault. The backend
          // logs the same fact when it loads the document.
          <p className={styles.empty}>
            This deployment&apos;s document for the{" "}
            {PROGRAM_LANGUAGE_NAMES[language]} arm of gg {arm.ggVersion} is
            empty. That is a broken projection rather than an arm gg does not
            have. The documents are written by <code>gg reference --out</code>{" "}
            and read from the directory <code>TCAB_GG_REFERENCE</code> names.
          </p>
        ) : selected ? (
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
                  <code>{requested}</code>. The eleven SDKs are idiomatic rather
                  than transliterations, so a name one arm spells this way
                  another may spell differently, or may not declare at all. Pick
                  one from the list.
                </>
              ) : (
                <>
                  Nothing on the {PROGRAM_LANGUAGE_NAMES[language]} arm of gg{" "}
                  {arm.ggVersion} could be opened: its entries name modules the
                  document does not declare. That is a broken projection; the
                  documents are written by <code>gg reference --out</code>.
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The arm picker: a dropdown over every program language this deployment can serve,
 * sitting above the sidebar whose contents it decides.
 *
 * Each option carries the arm's own function count, and every arm listed is one the
 * deployment can actually serve: the backend rebuilds the index's language list from the
 * documents it loaded, counting each one, so an option here is never one whose only
 * answer is a `404` and a number here is never a number nobody counted. An arm gg
 * registers whose document did not ship is therefore *absent* from this menu rather than
 * present and broken.
 *
 * When the address names an arm this deployment does not register, nothing is selected —
 * the placeholder holds the slot — rather than the menu quietly showing a different arm
 * than the one the address asked for.
 */
function ArmSelect({
  languages,
  selected,
  onSelect,
}: {
  languages: GgReferenceLanguage[];
  selected: GgProgramLanguage | null;
  onSelect: (language: GgProgramLanguage) => void;
}) {
  return (
    <select
      className={styles.armSelect}
      aria-label="SDK arm"
      value={selected ?? ""}
      onChange={(event) => {
        const next = event.target.value;
        if (isProgramLanguage(next)) onSelect(next);
      }}
    >
      {selected == null && <option value="">Pick an SDK arm…</option>}
      {languages.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {PROGRAM_LANGUAGE_NAMES[entry.id]} · {entry.functionCount} functions
        </option>
      ))}
    </select>
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
            {/* What binds the call. Two kinds of thing decide it and they are two fields
                rather than one "gate" string: the ending call is bound by the role the
                agent was dispatched in, and everything a run can configure is bought by a
                capability — and then, within it, granted by the agent's own allowlist,
                which is per agent rather than a property of the call and so has no chip
                here. There is deliberately no third field naming a *tool*: tool calling is
                a separate surface with its own vocabulary, and nothing on it gates
                anything on this one. */}
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
                an affirmative claim, so it is guarded on both fields that can withhold a
                call — a role and a capability — and it is not made about a type, which is a
                declaration and is not withheld from anybody. */}
            {entry.kind === "function" &&
              !entry.ending &&
              !entry.capability && (
                <span className={styles.chip}>always available</span>
              )}
          </div>
        </header>

        <Verbatim label="Documentation view" text={entry.body} />

        <TypeReferences entry={entry} arm={arm} onSelect={onSelect} />
      </div>
    </div>
  );
}

/**
 * The declarations one entry reaches, each linked to its own entry — and, for each, which
 * of the agent's three `docViewTypes` flags would open it beside this function.
 *
 * Names rather than declarations. The old single-arm document expanded every referenced
 * declaration into every function that mentioned it, which is what made one arm's document
 * four times the size of all eleven of these; the type's own entry is in this same
 * document, so the page links to it instead.
 *
 * The three "opens under" columns are gg's own answer, computed by the function a run
 * calls, rather than the guess a reader would otherwise make from the list: opening a
 * function appends type views exactly **one** level deep and only for the flags the
 * agent's `docViewTypes` has on, while this list is the transitive closure. Each column is
 * that flag ALONE, and the flags are independent, so a reader can read off any of the
 * eight configurations by unioning the columns it has on — which is why a row carrying no
 * chip at all says so out loud rather than leaving the reader to infer it from silence.
 *
 * The `errors` column is the one that is not a subset of the closure beside it: a declared
 * failure is written in a documentation comment rather than in a signature, so it can name
 * a type nothing in the signature does.
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
    // One entry per flag, in gg's own fixed order, so the chips on a row read in the same
    // order the recorded `docViewTypes` id joins them in.
    const flags: ReadonlyArray<{ id: string; opens: ReadonlySet<string> }> = [
      { id: "return", opens: new Set(entry.opensUnderReturn ?? []) },
      { id: "parameters", opens: new Set(entry.opensUnderParameters ?? []) },
      { id: "errors", opens: new Set(entry.opensUnderErrors ?? []) },
    ];
    const returned = new Set(entry.returns ?? []);
    // The closure first, in the document's own order, then anything the opens/returns
    // sets name that it does not — which the `errors` column genuinely can, since a
    // declared failure is not read out of the signature the closure is built from.
    const ordered = [
      ...(entry.types ?? []),
      ...[...returned, ...flags.flatMap((flag) => [...flag.opens])].filter(
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
        opensUnder: flags
          .filter((flag) => flag.opens.has(fqn))
          .map((flag) => flag.id),
      }));
  }, [arm.entries, entry]);

  if (rows.length === 0) return null;

  return (
    <Section label="Types this signature reaches">
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
            {row.opensUnder.map((flag) => (
              <span
                key={flag}
                className={`${styles.chip} ${flag === "return" ? styles.chipKey : ""}`}
              >
                opens under {flag}
              </span>
            ))}
            {row.opensUnder.length === 0 && (
              <span className={styles.chip}>opened by no flag</span>
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
