//! Finding a function nothing named to you: the searchable index over one language's committed
//! catalogue, and the ranking that decides what comes back first.
//!
//! It is the first half of the discovery chain the [documentation surface](super) is built around:
//!
//! ```text
//! a word the model has  →  search  →  briefs  →  openDocsView(key)  →  the full documentation
//! ```
//!
//! A search answers with **briefs only** — one line per hit — because the full text of an entry is
//! what a [docview](crate::context::ContextModel::open_docview) is for, and a search that returned
//! whole entries would put a page of documentation in front of a model that wanted a name. A brief
//! is enough to choose from; choosing is the model's next call.
//!
//! # It returns only what this agent may call
//!
//! Every hit is filtered through [`DocsRuntime::bound`](super::DocsRuntime::bound), the same single
//! predicate a lookup and the [agent surface](test_cabinet_core::gg::GgTelemetryKind::AgentSurface)
//! answer from, and never through a second copy of it. That is not politeness: with the prompt no
//! longer naming functions, search **is** how an agent learns what it has, so a search that returned
//! a withheld function would teach a model a call that throws when it writes it — the exact failure
//! a directory exists to prevent, arrived at from the other side.
//!
//! A **type** is visible when any function referencing it is bound. A type is not a call, so nothing
//! is withheld by being able to read what a record's fields mean; what would be wrong is advertising
//! the shape of a value only an unbound function can produce.
//!
//! # Two sources, one ranking
//!
//! The catalogue is not the only thing a query reaches. A [code skill or memory](crate::knowledge)
//! an agent has brought into use puts its module and each of its declarations on the same surface,
//! and those entries are [owned, per-instance state](super::LoadedDocs) rather than a projection of
//! anything compiled in — so they cannot be folded into the `&'static` index, and they are unioned
//! at query time instead. Both sources are scored by [one function](score) over
//! [four texts](Fields) and ranked in one list, because a model asking *what can do this* must be
//! answered by whichever of the two knows, in one order, without having to ask twice.
//!
//! Nothing gates the second source. Those entries describe code *this* instance loaded, so the
//! question `bound` answers about gg's own surface — may this agent call it — was settled when the
//! module was loaded.
//!
//! # Why the ranking is tiered rather than scored
//!
//! For the reason [`suggest`](super::suggest) gives about near-misses, and it is the same problem: a
//! single blended score has to weigh an identifier match against a word in a paragraph, and whatever
//! weights it picks it will one day rank a mention above a name. Tiers do not. An entry is filed by
//! the **kind** of evidence that matched it — its own name, its signature, its brief, its detail —
//! and a worse kind never outranks a better one however often it occurs.
//!
//! Two of those four are **read off the catalogue's structure rather than off its rendered text**,
//! and that is what makes the scheme mean the same thing on eleven arms. An argument's *name* is
//! signature evidence and an argument's *documentation* is detail evidence, on every arm — but only
//! ten of the eleven write the name into the signature string, because PureScript's declaration is a
//! curried type (`editFile :: String -> String -> String -> Effect Unit`) that is valid PureScript
//! and names nothing. Indexed from the rendering alone, a query for an argument's name found the
//! call on ten arms and nothing on the eleventh, and the tier a search reported would have been a
//! fact about a language's syntax rather than about the evidence. So the names and the descriptions
//! come from `parameters`, which all eleven carry in full. See [`DocEntry::signature`].
//!
//! There is deliberately **no tuning surface**: no weights, no per-agent knob, and no committed
//! table of expected results. What holds the ranking honest is the discoverability gate in
//! `docs.discoverability.test.rs`, which asserts the property that actually matters — that every
//! capability an agent is granted can be *found* from the words a model would reach for — rather
//! than freezing a particular order that a reshaped SDK would then have to be edited to reproduce.

use std::cmp::Ordering;
use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::search::{Relevance, breadth_then_frequency, normalize, relevance};
use crate::tools::ToolFailure;

use super::ProgramLanguage;
use super::suggest::fold;
use crate::sandbox::{
    CatalogueFunction, Parameter, SignatureEntry, TypeReference, ViewRefusal, catalogue_functions,
};

/// Which kind of thing an [entry](DocEntry) documents.
///
/// Three: a module a program imports, a function it calls, and a type its signatures mention. They
/// are the three things a model has to be able to find, and the module is the one it needs first,
/// because nothing gg offers is in scope until the program has imported the module the symbol lives
/// in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocKind {
    /// A module this language's SDK is divided into — whatever that language makes importable.
    Module,
    /// A function this language's SDK offers.
    Function,
    /// A type its signatures mention.
    Type,
}

/// The `kind` filter's spelling of [`DocKind::Module`].
const KIND_MODULE: &str = "module";
/// The `kind` filter's spelling of [`DocKind::Function`].
const KIND_FUNCTION: &str = "function";
/// The `kind` filter's spelling of [`DocKind::Type`].
const KIND_TYPE: &str = "type";

impl DocKind {
    /// The word a filter names this kind by, and a hit reports it as.
    pub fn id(self) -> &'static str {
        match self {
            Self::Module => KIND_MODULE,
            Self::Function => KIND_FUNCTION,
            Self::Type => KIND_TYPE,
        }
    }
}

/// One **module** an entry belongs to: gg's own id for it, and how this language writes it.
///
/// The two are separate because they are read by different readers and neither can be recovered
/// from the other. The **id** is the cross-arm vocabulary — `files`, `board`, `views` — taken from
/// the [operations table](crate::sandbox::operation_of), which is where gg states it once; it is
/// what the prompt will name and what a cross-language readout joins on. The **path** is the
/// spelling a model of *this* arm reads, which today is the API object a function hangs off and
/// becomes the idiomatic module path when each arm's catalogue carries one.
///
/// A module filter accepts either, so a prompt naming gg's id and a model typing a path it has seen
/// both work. Every entry belongs to exactly one module, so the string a [hit](DocHit::module)
/// reports is a value the filter takes: reading a hit's module and searching on it answers with
/// that module's directory. The filter takes a **list** of them, and a list is a union — an
/// intersection would be empty for every pair, since no entry is in two modules, so the only
/// reading several modules have is *these modules' directories, together*.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DocModule {
    /// gg's language-independent id for the module (`files`).
    pub id: &'static str,
    /// How this language writes it (`fs`).
    pub path: &'static str,
}

/// One searchable entry: what it documents, where it lives, and the four texts a query is matched
/// against.
///
/// The three prose fields are held **lowercased**, because matching is case-insensitive and a search
/// that lowercased them per query would do it once per term per entry per call for a value that
/// cannot change. The brief is also kept in its authored casing, since that is what a hit displays.
struct DocEntry {
    /// The key `openDocsView` takes: the entry's fully-qualified name where its arm emits one, and
    /// its bare name where it does not.
    ///
    /// Functions and types are keyed the same way deliberately. They share one namespace — a model
    /// types one string and [`read_any`](super::DocsRuntime::read_any) decides which kind it names —
    /// and keying one half on a module-qualified name while the other stayed bare would have left
    /// two entries able to collide under one key on exactly the half the qualification was
    /// introduced to protect.
    key: &'static str,
    /// Which kind of thing this is.
    kind: DocKind,
    /// The module it belongs to, over the **whole** catalogue: for a function the module that
    /// publishes it, for a module itself, and for a type the module that **declares** it.
    ///
    /// A type is filed where it is declared rather than where it is mentioned. The two differ
    /// often — every module's calls mention the error type, and `gg.views.openFile` hands back a
    /// type `gg.files` declares — and filing a type by mention makes a module's directory answer
    /// with other modules' declarations. Where a type is *reachable from* is a separate question,
    /// answered by [`referenced_by`](Self::referenced_by).
    modules: Vec<DocModule>,
    /// The name a program calls it by, or the type's own name.
    name: &'static str,
    /// The identity a function is filed under in this language's catalogue — `(object, key)` — which
    /// is what [`DocsRuntime::bound`](super::DocsRuntime::bound) is asked about. `None` for a type,
    /// whose visibility is decided by [`referenced_by`](Self::referenced_by) instead.
    identity: Option<(&'static str, &'static str)>,
    /// For a **type**, the positions of the function entries that reach it — the whole of how a
    /// type's visibility is derived. Empty for a function.
    ///
    /// A reference counts when one of the function's own signatures writes the type's name. A type
    /// reached only through some other type's members is a level deeper than any signature the
    /// model reads, and a type a function only **declares it throws** is reached by no signature at
    /// all: a failure class is delivered beside the call it belongs to, under `docViewTypes`, and is
    /// not an entry a search hands back.
    referenced_by: Vec<usize>,
    /// The name reduced to what a comparison should ignore, by the same
    /// [fold](super::suggest) a failed lookup's hint uses — so a query for `write_file` finds
    /// `writeFile` on every arm that spells it that way.
    folded: String,
    /// The rendered signature text, joined across every shape this language offers the function in
    /// and followed by [every argument's name](parameter_names); for a type, its declaration.
    /// Lowercased.
    signature: String,
    /// The one-line brief, as authored.
    brief: &'static str,
    /// The brief, lowercased.
    brief_folded: String,
    /// The detail beneath the brief — everything the documentation says after its first line, plus
    /// [what each argument's own line says](parameter_docs) — with the brief itself removed, so a
    /// word in the brief is not also counted here. Lowercased.
    ///
    /// An argument's description belongs here rather than with the signature because it is prose:
    /// it is rendered under the signature in a [docview](super::DocsRuntime::read), and a sentence
    /// about what to put in a field is the weakest kind of evidence there is that a call is the one
    /// the model meant — which is exactly what this tier says.
    detail_folded: String,
}

/// The [tier](self) an entry earns when a term equals its folded identifier — the surest evidence
/// there is, and the reason a query naming a function exactly is never buried under a paragraph
/// that mentions it.
const TIER_IDENTIFIER_EXACT: u8 = 0;
/// The tier for a term the identifier **starts with**.
const TIER_IDENTIFIER_PREFIX: u8 = 1;
/// The tier for a term the identifier merely **contains** — what makes `foobar` find `getFoobar`.
const TIER_IDENTIFIER_CONTAINS: u8 = 2;
/// The tier for a term in the **signature**: an argument type, or an argument's name — the latter
/// taken from the catalogue's `parameters` rather than from the rendering, so that it is available
/// on the one arm whose declaration syntax writes no names. See [`parameter_names`].
const TIER_SIGNATURE: u8 = 3;
/// The tier for a term in the **brief**.
const TIER_BRIEF: u8 = 4;
/// The tier for a term in the **detail** — the weakest evidence, and still evidence.
const TIER_DETAIL: u8 = 5;

/// How one entry scored: the kind of evidence that matched it, and how much of it there was.
#[derive(Debug, Clone, Copy)]
struct Scored {
    /// The **best** tier any single term achieved on this entry.
    tier: u8,
    /// Breadth and frequency across every field, for the ordering within the tier.
    relevance: Relevance,
}

/// One language's searchable catalogue.
pub struct DocIndex {
    entries: Vec<DocEntry>,
}

/// The [index](DocIndex) for `language`, built on first use and kept for the process.
///
/// One slot per registered language rather than one shared table, because an index is a projection
/// of one arm's catalogue and building it forces that catalogue's parse — so a table
/// covering every arm would make the first search on any arm parse all eleven. Indexed by
/// [`ordinal`](GgProgramLanguage::ordinal), which is exactly what that method exists for.
///
/// It is built here rather than emitted by a reflector, and deliberately. The catalogue it is
/// derived from is already compiled into the binary — `crates/gg/build.rs` reflects it and this
/// crate embeds it — so a precomputed index would be a second projection of the same text, produced
/// by a twelfth tool nobody has, for a build that takes microseconds over forty-odd functions.
/// Deriving it at first use also means it can never describe a surface the catalogue does not.
fn index(language: &'static dyn ProgramLanguage) -> &'static DocIndex {
    static INDEXES: [OnceLock<DocIndex>; GgProgramLanguage::COUNT] =
        [const { OnceLock::new() }; GgProgramLanguage::COUNT];
    INDEXES[language.id().ordinal()].get_or_init(|| DocIndex::build(language))
}

impl DocIndex {
    /// Build the index for one language from its catalogue.
    ///
    /// Functions first, then types, and the order matters: a type records the **positions** of the
    /// functions referencing it, which is how its visibility is derived, and those positions have to
    /// exist before they can be recorded.
    ///
    /// A function gg has no [operation](crate::sandbox::operation_of) for is skipped rather than
    /// indexed under a fallback module. It could never be returned anyway —
    /// [`bound`](super::DocsRuntime::bound) refuses exactly those — and an entry no search can
    /// return is not an entry; inventing a module id for it would put a name in gg's cross-arm
    /// vocabulary that nothing on gg's side chose.
    fn build(language: &'static dyn ProgramLanguage) -> Self {
        let mut entries: Vec<DocEntry> = Vec::new();
        // The catalogue's own `types` list per function, kept beside the entry so the type pass can
        // ask which functions named it without walking the catalogue a second time, and the
        // function itself, which is what says whether a named type is one of its own signatures'.
        let mut references: Vec<&'static [TypeReference]> = Vec::new();
        let mut catalogued: Vec<CatalogueFunction> = Vec::new();
        for function in catalogue_functions(language) {
            let Some(operation) = crate::sandbox::operation_of(&function) else {
                continue;
            };
            let brief = function.prose.brief;
            entries.push(DocEntry {
                key: function.fqn,
                kind: DocKind::Function,
                modules: vec![DocModule {
                    id: operation.id.namespace,
                    path: function.object,
                }],
                name: function.name,
                identity: Some((function.object, function.key)),
                referenced_by: Vec::new(),
                folded: fold(function.name),
                signature: format!(
                    "{}{}",
                    function
                        .signatures
                        .iter()
                        .map(|entry| entry.signature.as_str())
                        .collect::<Vec<_>>()
                        .join("\n"),
                    parameter_names(function.signatures),
                )
                .to_lowercase(),
                brief,
                brief_folded: brief.to_lowercase(),
                detail_folded: format!(
                    "{}{}",
                    function.prose.detail.unwrap_or_default(),
                    parameter_docs(function.signatures),
                )
                .to_lowercase(),
            });
            references.push(function.types);
            catalogued.push(function);
        }

        let functions = entries.len();

        // The modules, keyed by the path a model reads and writes. A module is visible exactly where
        // one of its own functions is, which is the rule a type already follows and for the same
        // reason: the module is not itself a call, and an agent that may call something in it must
        // be able to read where that something lives and how to reach it.
        //
        // The import line is folded into the searchable signature text, so a model that has seen an
        // import line somewhere and half-remembers it can search its way back to the module.
        for module in crate::sandbox::catalogue_modules(language) {
            let referenced_by: Vec<usize> = (0..functions)
                .filter(|position| entries[*position].modules.iter().any(|m| m.id == module.id))
                .collect();
            let brief = module.prose.brief;
            entries.push(DocEntry {
                key: module.path,
                kind: DocKind::Module,
                modules: vec![DocModule {
                    id: module.id,
                    path: module.path,
                }],
                name: module.path,
                identity: None,
                referenced_by,
                folded: fold(module.path),
                signature: module.import.unwrap_or(module.path).to_lowercase(),
                brief,
                brief_folded: brief.to_lowercase(),
                detail_folded: module.prose.detail.unwrap_or_default().to_lowercase(),
            });
        }

        for declaration in &language.catalogue().types {
            let name = declaration.name.as_str();
            // A reference resolves to the type's own key — its fully-qualified name where the arm
            // emits one, and its bare name where it does not — while what a model *reads* and
            // matches on stays the name the signature writes.
            let key = declaration.key();
            let referenced_by: Vec<usize> = (0..functions)
                .filter(|position| {
                    reaches(&catalogued[*position], references[*position], key, name)
                })
                .collect();
            // The module that declares it, which is the module a search filtered to it should
            // answer with. A type nothing reachable references is invisible whatever it says here.
            let modules: Vec<DocModule> =
                crate::sandbox::module_of(language.catalogue(), &declaration.module)
                    .map(|module| {
                        vec![DocModule {
                            id: module.id,
                            path: module.path,
                        }]
                    })
                    .unwrap_or_default();
            let prose = declaration.prose();
            let brief = prose.brief;
            entries.push(DocEntry {
                key,
                kind: DocKind::Type,
                modules,
                name,
                identity: None,
                referenced_by,
                folded: fold(name),
                signature: declaration.declaration.to_lowercase(),
                brief,
                brief_folded: brief.to_lowercase(),
                detail_folded: prose.detail.unwrap_or_default().to_lowercase(),
            });
        }
        Self { entries }
    }

    /// Whether the entry at `position` is the type `filter` names, or a function whose signature
    /// mentions it — the `type` filter, which asks *what can I do with a value of this shape*.
    ///
    /// Answering it from the referencing side is the honest reading of today's catalogue: an arm
    /// records which types a function mentions and nothing about functions hanging off a type,
    /// because no arm hangs any off one yet. When they do, this narrows to the type's own member
    /// functions and stops being a scan over every signature.
    fn concerns_type(&self, position: usize, filter: &str) -> bool {
        let entry = &self.entries[position];
        match entry.kind {
            DocKind::Type => entry.name.eq_ignore_ascii_case(filter),
            DocKind::Function => self.entries.iter().any(|declaration| {
                declaration.kind == DocKind::Type
                    && declaration.name.eq_ignore_ascii_case(filter)
                    && declaration.referenced_by.contains(&position)
            }),
            // A module names no type, so it is never what *what can I do with a value of this
            // shape* is asking for. Composing the two filters narrows to nothing rather than
            // widening to every module the matching functions live in.
            DocKind::Module => false,
        }
    }
}

/// What a documentation search asks for: the words, the filters, and the page.
///
/// Every filter is optional and they compose. An **empty query with a module filter** is a directory
/// of that module, which is the thing a per-object `list` used to be for one object and is now
/// global — and is the first hop of the discovery chain, since a filter is an exact lookup rather
/// than a ranking problem.
#[derive(Debug, Clone, Copy, Default)]
pub struct DocQuery<'a> {
    /// The words to look for, as one string. Split on whitespace, then trimmed, lowercased and
    /// de-duplicated: a substring search over identifiers is a line a model types, not a list it
    /// assembles.
    pub query: &'a str,
    /// Restrict to these modules, each named by either gg's [id](DocModule::id) or this language's
    /// [path](DocModule::path). Case-insensitive, and **exact** — a module filter is a lookup.
    ///
    /// Several name a **union**: an entry in any one of them is a hit. An intersection would be
    /// empty for every pair, since an entry belongs to one module, so the only reading a list has is
    /// the one that answers *these modules' directories, together*. An empty list is no filter.
    pub modules: &'a [String],
    /// Restrict to one type and the functions whose signatures mention it — *what can I do with a
    /// value of this shape*. Case-insensitive and exact on the type's own name.
    pub declared_type: Option<&'a str>,
    /// Restrict to `"function"` or `"type"`. An unrecognised word is refused rather than ignored,
    /// so a typo cannot silently widen a search the model believed it had narrowed.
    pub kind: Option<&'a str>,
    /// How many hits to skip. The house file-read window, not a cursor.
    pub offset: Option<u32>,
    /// How many hits to return, capped at [`MAX_SEARCH_LIMIT`] and defaulting to
    /// [`DEFAULT_SEARCH_LIMIT`].
    pub limit: Option<u32>,
}

/// One hit: enough to choose from, and no more.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocHit {
    /// What `openDocsView` takes to read the whole thing.
    pub key: String,
    /// Whether this is a function or a type.
    pub kind: DocKind,
    /// The module(s) it lives in, as this language writes them — and for a type, only those the
    /// asking agent holds a bound function in. See [`DocEntry::hit`].
    pub module: String,
    /// The callable's own name, or the type's.
    pub name: String,
    /// The **brief**, and only the brief. The rest is what a docview is for.
    pub summary: String,
}

/// A page of hits, with the total behind it.
///
/// The total is deliberate. `search_memories` answers with a bare list, so a model cannot tell a
/// capped page from a complete result and has no way to know whether to ask for more — the failure
/// the archive search's envelope already exists to avoid. A paginated discovery surface cannot
/// afford it: an agent that stops at the first page because it looks complete has silently lost the
/// rest of its surface.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocSearch {
    /// How many entries matched **before** paging.
    pub total: u32,
    /// The offset this page starts at, echoed back so a model can page without tracking it.
    pub offset: u32,
    /// The page itself, best first.
    pub hits: Vec<DocHit>,
}

/// How many hits a search returns when the caller names no limit.
///
/// Enough that a well-aimed query is answered in one call, and small enough that a vague one costs a
/// few lines rather than the whole surface. A model that wanted everything asks for it.
pub const DEFAULT_SEARCH_LIMIT: u32 = 20;

/// The most hits one page may carry, whatever the caller asks for.
///
/// It clamps rather than refuses: a limit past the ceiling is a model asking for *all of it*, which
/// is a reasonable thing to mean, and the envelope's [`total`](DocSearch::total) then tells it
/// exactly how much it did not get.
pub const MAX_SEARCH_LIMIT: u32 = 100;

impl super::DocsRuntime {
    /// **Search this agent's documentation surface**: the functions it may call and the types their
    /// signatures mention, ranked, paginated, and answered with briefs.
    ///
    /// # Refusals, and why they are refusals
    ///
    /// A query that normalizes to nothing **and** carries no filter is refused rather than answered
    /// with an empty page, on the precedent a keyword-less memory search sets: *you gave me nothing
    /// to look for* and *nothing here matches* are different answers, and a model that cannot tell
    /// them apart will rewrite a query that was never the problem. An unrecognised `kind` is refused
    /// for the stronger version of the same reason — ignoring it would return a **wider** result
    /// than the model asked for, and it would have no way to notice.
    ///
    /// A page size of zero is refused too: it is a call that can never return anything, and reading
    /// it as *the default* would be gg deciding what a model meant.
    pub fn search(&self, query: DocQuery<'_>) -> Result<DocSearch, ViewRefusal> {
        let terms = normalize(query.query.split_whitespace());
        let kind = match query.kind.map(str::trim).filter(|kind| !kind.is_empty()) {
            None => None,
            Some(kind) if kind.eq_ignore_ascii_case(KIND_MODULE) => Some(DocKind::Module),
            Some(kind) if kind.eq_ignore_ascii_case(KIND_FUNCTION) => Some(DocKind::Function),
            Some(kind) if kind.eq_ignore_ascii_case(KIND_TYPE) => Some(DocKind::Type),
            Some(kind) => {
                return Err(ViewRefusal {
                    failure: ToolFailure::InvalidArgument,
                    message: format!(
                        "`{kind}` is not a kind of documentation entry; use `{KIND_MODULE}`, \
                         `{KIND_FUNCTION}` or `{KIND_TYPE}`, or leave it out for all three"
                    ),
                });
            }
        };
        let modules: Vec<&str> = query
            .modules
            .iter()
            .map(|module| module.trim())
            .filter(|module| !module.is_empty())
            .collect();
        let declared_type = query
            .declared_type
            .map(str::trim)
            .filter(|it| !it.is_empty());
        if terms.is_empty() && modules.is_empty() && declared_type.is_none() && kind.is_none() {
            return Err(ViewRefusal {
                failure: ToolFailure::InvalidArgument,
                message:
                    "a search needs something to look for: a query, or a `modules`, `type` or \
                          `kind` filter"
                        .to_string(),
            });
        }
        let limit = match query.limit {
            None => DEFAULT_SEARCH_LIMIT,
            Some(0) => {
                return Err(ViewRefusal {
                    failure: ToolFailure::InvalidArgument,
                    message: "a page of zero hits would answer nothing; leave `limit` out for \
                              the default"
                        .to_string(),
                });
            }
            Some(limit) => limit.min(MAX_SEARCH_LIMIT),
        };
        let offset = query.offset.unwrap_or(0);

        let index = index(self.language);
        let visible = self.visible(index);
        // One list over both sources, built as **hits** rather than as entries, because the two
        // sources have nothing else in common: one is a `&'static` projection of a compiled-in
        // catalogue and the other is an owned, per-instance registry, and the only thing the ranking
        // needs of either is what a model would read. Everything the sort reads — the key, the kind
        // — a hit already carries.
        let mut ranked: Vec<(Scored, DocHit)> = Vec::new();
        for (position, entry) in index.entries.iter().enumerate() {
            if !visible[position] {
                continue;
            }
            if kind.is_some_and(|kind| kind != entry.kind) {
                continue;
            }
            // One list, filtered on and reported from, so the module a hit says it lives in and the
            // module a filter would have found it under are the same answer.
            if !modules.is_empty() && !in_modules(&entry.modules, &modules) {
                continue;
            }
            if declared_type.is_some_and(|name| !index.concerns_type(position, name)) {
                continue;
            }
            // An empty query with a filter is a directory, so a filtered entry with nothing to score
            // against is a hit at the weakest tier — ranked, in that case, entirely by its key.
            let scored = match terms.is_empty() {
                true => directory_hit(),
                false => match entry.score(&terms) {
                    Some(scored) => scored,
                    None => continue,
                },
            };
            ranked.push((scored, entry.hit(&entry.modules)));
        }
        // The second source, scored by the same rules and ranked in the same list. Nothing gates it:
        // these entries describe code *this instance* brought into use, so the question `visible`
        // answers about gg's own surface — may this agent call it — was answered when the module was
        // loaded.
        self.loaded().read(|entries| {
            for entry in entries {
                if kind.is_some_and(|kind| kind != entry.kind) {
                    continue;
                }
                if !modules.is_empty() && !entry.in_modules(&modules) {
                    continue;
                }
                if declared_type.is_some_and(|name| !entry.concerns_type(name)) {
                    continue;
                }
                let scored = match terms.is_empty() {
                    true => directory_hit(),
                    false => match score(
                        &Fields {
                            folded: &entry.folded,
                            signature: &entry.signature,
                            brief: &entry.brief_folded,
                            detail: &entry.detail_folded,
                        },
                        &terms,
                    ) {
                        Some(scored) => scored,
                        None => continue,
                    },
                };
                ranked.push((
                    scored,
                    DocHit {
                        key: entry.key.clone(),
                        kind: entry.kind,
                        module: entry.module.clone(),
                        name: entry.name.clone(),
                        summary: entry.brief.clone(),
                    },
                ));
            }
        });
        ranked.sort_by(|(left, a), (right, b)| {
            left.tier
                .cmp(&right.tier)
                .then(breadth_then_frequency(&left.relevance, &right.relevance))
                // A type wins a tie against a function, on the **identifier** tiers alone. On an SDK
                // whose types and functions are named out of the same words — C++'s `file_read`
                // beside its `read_file` — a query landing on both at the same tier with the same
                // breadth is a query about the shape, since the function is reachable from the
                // type's own view and not the other way round.
                //
                // It is confined to those two tiers deliberately. Below them the evidence is prose,
                // where being a type says nothing about whether the entry is what was meant; and
                // applying it everywhere would silently reorder the one case that has no evidence at
                // all — a **directory** (an empty query with a filter), where every entry is tied
                // and the answer would become *every type, then every function* rather than the
                // plain alphabetical list a directory should be.
                .then_with(|| match left.tier <= TIER_IDENTIFIER_PREFIX {
                    true => kind_bias(a.kind).cmp(&kind_bias(b.kind)),
                    false => Ordering::Equal,
                })
                // The last word, and the reason a search is reproducible across runs.
                .then(a.key.cmp(&b.key))
        });

        let total = ranked.len();
        let hits = ranked
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .map(|(_, hit)| hit)
            .collect();
        Ok(DocSearch {
            total: saturating(total),
            offset,
            hits,
        })
    }

    /// Which entries of `index` this agent may be shown, one flag per entry in index order.
    ///
    /// Functions are asked of [`bound`](super::DocsRuntime::bound) — the single predicate, never a
    /// second copy — through the catalogue projection it takes. Types are visible when **any**
    /// function referencing them is, which is why the flags are computed as a pass over the whole
    /// index rather than per entry: a type's answer is a function of the functions' answers.
    fn visible(&self, index: &DocIndex) -> Vec<bool> {
        let bound: Vec<(&'static str, &'static str)> = catalogue_functions(self.language)
            .into_iter()
            .filter(|function| self.bound(function))
            .map(|function| (function.object, function.key))
            .collect();
        let mut visible: Vec<bool> = index
            .entries
            .iter()
            .map(|entry| match entry.identity {
                Some(identity) => bound.contains(&identity),
                None => false,
            })
            .collect();
        // A type and a module are both visible through the functions that reach them: a type
        // through the ones whose signatures name it, a module through the ones it publishes.
        // Neither is a call, so neither is gated on its own account, and both are asked the one
        // question `bound` answers about the functions underneath them.
        for (position, entry) in index.entries.iter().enumerate() {
            if matches!(entry.kind, DocKind::Type | DocKind::Module) {
                visible[position] = entry.referenced_by.iter().any(|at| visible[*at]);
            }
        }
        visible
    }
}

/// Whether `function` reaches the type keyed `key` and named `name` **through one of its own
/// signatures** — the one reference that makes a type an entry a search hands back.
///
/// The catalogue's per-function `types` list is transitively closed, so read raw it answers with
/// every declaration a program holding this call's values could end up looking at. Two of those
/// are not entries a search should return, and both are excluded here.
///
/// - A type reached only through some **other** type's members. `ApiErrorCode` is a field of
///   `ApiError`; no signature writes it, and a model choosing between hits has no call to make with
///   it. This is the same depth-one narrowing
///   [`types_to_open`](crate::docs::DocsRuntime::types_to_open) applies before it opens a view.
/// - A type the function only **declares it throws**. A failure class is documentation about a call
///   rather than a thing to look up: it is delivered beside that call's own page, under the agent's
///   `docViewTypes`, and every module's every function declares the same one — so filing it as a
///   hit puts one answer in every directory of every module that never declared it.
fn reaches(
    function: &CatalogueFunction,
    references: &'static [TypeReference],
    key: &str,
    name: &str,
) -> bool {
    if function.throws.iter().any(|thrown| thrown.fqn() == key) {
        return false;
    }
    references.iter().any(|kind| kind.fqn() == key) && super::names_a_signature(function, name)
}

/// Every argument name the shapes of one function declare, structured fields included, one per line
/// and with a leading newline so it appends to a rendered signature.
///
/// **Why the names are read off `parameters` rather than out of the rendering.** A parameter's name
/// is signature evidence, and on ten arms it is *in* the signature string because their declaration
/// syntax writes it there. PureScript's does not: a call is declared as a curried type,
/// `editFile :: String -> String -> String -> Effect Unit`, which is the honest rendering of what
/// that arm's SDK declares and names no argument at all. Its catalogue names every one of them, and
/// documents them, in `parameters` — so before this, a model on that arm searching `oldString` was
/// told nothing matched, while the same query on the ten others returned the call at
/// [`TIER_SIGNATURE`]. The tier is a claim about the *kind of evidence*, and it can only mean the
/// same thing on eleven arms if it is read from the thing all eleven carry.
///
/// A name an arm does also write into its rendering is therefore counted twice on that arm. That is
/// deliberate rather than tolerated. The alternative — appending a name only when the rendering does
/// not already contain it — is a substring test that would drop a genuine second occurrence and make
/// one entry's frequency depend on another field's spelling; and the doubling is uniform across every
/// entry of an arm, since an arm renders names in all its signatures or in none, so it cannot reorder
/// two entries within a tier.
///
/// The **fields** of a structured argument are walked too. A model writing a call reads
/// `openDocsView`'s `key` and a search options record's `limit` as the same kind of thing, and only
/// one of them is a top-level parameter.
fn parameter_names(signatures: &'static [SignatureEntry]) -> String {
    let mut out = String::new();
    for entry in signatures {
        for parameter in &entry.parameters {
            append_parameter(parameter, &mut out, |parameter| &parameter.name);
        }
    }
    out
}

/// What each argument's own line says, for every shape, one per line and with a leading newline so
/// it appends to an entry's detail.
///
/// It is [detail](DocEntry::detail_folded) rather than signature evidence: the *name* is part of how
/// the call is written, and the sentence beneath it is prose about what to put there. A model that
/// searched the words of that sentence — `absolute path`, `wall-clock budget` — matched nothing at
/// all before this, on any of the eleven arms, although it is text every docview shows.
fn parameter_docs(signatures: &'static [SignatureEntry]) -> String {
    let mut out = String::new();
    for entry in signatures {
        for parameter in &entry.parameters {
            append_parameter(parameter, &mut out, |parameter| &parameter.doc);
        }
    }
    out
}

/// One argument's `text`, and every field of it, appended to `out` a line at a time.
fn append_parameter(
    parameter: &'static Parameter,
    out: &mut String,
    text: fn(&'static Parameter) -> &'static str,
) {
    out.push('\n');
    out.push_str(text(parameter));
    for field in &parameter.fields {
        append_parameter(field, out, text);
    }
}

/// Where a kind sorts when everything else about two entries is equal: modules, then types, then
/// functions.
///
/// A module leads because it is the one entry the others depend on: a model that has matched a
/// module and a function in it equally well needs the module first, since the function is not a
/// name it can write until the module is imported.
fn kind_bias(kind: DocKind) -> u8 {
    match kind {
        DocKind::Module => 0,
        DocKind::Type => 1,
        DocKind::Function => 2,
    }
}

/// A count as the envelope reports it, saturating rather than wrapping — a catalogue is forty-odd
/// entries, so this can only ever be the identity, and saturating says that without an `as` cast
/// that would silently stop being one.
fn saturating(total: usize) -> u32 {
    u32::try_from(total).unwrap_or(u32::MAX)
}

/// Whether `modules` contains any module `filters` names, by gg's id or by this language's path.
/// Case-insensitive and exact: a module filter is a lookup, not a ranking.
fn in_modules(modules: &[DocModule], filters: &[&str]) -> bool {
    filters.iter().any(|filter| {
        modules.iter().any(|module| {
            module.id.eq_ignore_ascii_case(filter) || module.path.eq_ignore_ascii_case(filter)
        })
    })
}

/// **The four texts a query is matched against**, borrowed from whichever source holds them.
///
/// Two sources feed one ranking: the `&'static` [index](DocIndex) over a compiled-in catalogue, and
/// the owned, per-instance [registry](super::LoadedDocs) of the code modules an agent loaded. They
/// share no type and never will — one is a projection of the binary and the other is text that
/// arrived at a turn — but a hit from either must sort against a hit from the other on identical
/// evidence, so what the ranking reads is stated once, here, as four strings.
///
/// The three prose fields arrive **lowercased**, because matching is case-insensitive and a source
/// that lowercased them per query would do it once per term per entry per call for a value that
/// cannot change.
struct Fields<'a> {
    /// The identifier, [folded](fold) — case and separators dropped.
    folded: &'a str,
    /// The rendered signature or declaration text.
    signature: &'a str,
    /// The one-line brief.
    brief: &'a str,
    /// Everything the documentation says beneath its first line.
    detail: &'a str,
}

/// Score one entry's `fields` against already-[normalized](normalize) `terms`, or `None` when no
/// term matched any of the four.
///
/// The entry's tier is the **best** any single term achieved, so one term landing on the name
/// carries an entry that another term only brushed in a paragraph. Breadth and frequency are
/// summed across every field, because they answer a different question from the tier: *how much
/// of what you asked for is in here*, rather than *what kind of thing matched*.
fn score(fields: &Fields<'_>, terms: &[String]) -> Option<Scored> {
    let mut tier: Option<u8> = None;
    let mut matched = 0;
    let mut occurrences = 0;
    for term in terms {
        // The identifier is matched **folded** — case and separators dropped — which is what
        // lets one query find `write_file`, `writeFile` and `WriteFile` on the three arms that
        // spell it those ways. Everything else is prose or source text, where folding would
        // destroy exactly the structure being matched.
        let folded = fold(term);
        let identifier = match folded.is_empty() {
            true => Relevance::default(),
            false => relevance(fields.folded, std::slice::from_ref(&folded)),
        };
        let identifier_tier = if folded.is_empty() {
            None
        } else if fields.folded == folded {
            Some(TIER_IDENTIFIER_EXACT)
        } else if fields.folded.starts_with(&folded) {
            Some(TIER_IDENTIFIER_PREFIX)
        } else if identifier.is_match() {
            Some(TIER_IDENTIFIER_CONTAINS)
        } else {
            None
        };
        let term = std::slice::from_ref(term);
        let signature = relevance(fields.signature, term);
        let brief = relevance(fields.brief, term);
        let detail = relevance(fields.detail, term);
        let Some(term_tier) = identifier_tier
            .or_else(|| signature.is_match().then_some(TIER_SIGNATURE))
            .or_else(|| brief.is_match().then_some(TIER_BRIEF))
            .or_else(|| detail.is_match().then_some(TIER_DETAIL))
        else {
            continue;
        };
        matched += 1;
        occurrences +=
            identifier.occurrences + signature.occurrences + brief.occurrences + detail.occurrences;
        tier = Some(tier.map_or(term_tier, |best| best.min(term_tier)));
    }
    tier.map(|tier| Scored {
        tier,
        relevance: Relevance {
            matched,
            occurrences,
            first_at: None,
        },
    })
}

/// What a hit scores when there is **nothing to score it against**: an empty query carrying a
/// filter, which is a directory rather than a ranking.
///
/// The weakest tier and no relevance at all, so the whole result is tied and the key alone orders it
/// — which is what makes a directory read as the plain alphabetical list it should be. Named because
/// both sources produce it and a second spelling of "tied at the bottom" is a second thing to keep
/// in step.
fn directory_hit() -> Scored {
    Scored {
        tier: TIER_DETAIL,
        relevance: Relevance::default(),
    }
}

impl DocEntry {
    /// Score this entry against already-[normalized](normalize) `terms`, or `None` when no term
    /// matched any of its four fields — [the one ranking](score), over this entry's own texts.
    fn score(&self, terms: &[String]) -> Option<Scored> {
        score(
            &Fields {
                folded: &self.folded,
                signature: &self.signature,
                brief: &self.brief_folded,
                detail: &self.detail_folded,
            },
            terms,
        )
    }

    /// This entry as a model reads it in a result list, under the module
    /// [it belongs to](Self::modules).
    ///
    /// The module is written as this arm's path for it, which is the spelling the `modules` filter
    /// takes and the one the prompt's module list shows — so the module a hit reports is a value a
    /// model can hand straight back. An entry gg has no module for reports none rather than
    /// inventing one.
    fn hit(&self, modules: &[DocModule]) -> DocHit {
        DocHit {
            key: self.key.to_string(),
            kind: self.kind,
            module: modules
                .first()
                .map(|module| module.path.to_string())
                .unwrap_or_default(),
            name: self.name.to_string(),
            summary: self.brief.to_string(),
        }
    }
}

#[cfg(test)]
#[path = "docs.search.test.rs"]
mod tests;
