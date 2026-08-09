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
//! # Why the ranking is tiered rather than scored
//!
//! For the reason [`suggest`](super::suggest) gives about near-misses, and it is the same problem: a
//! single blended score has to weigh an identifier match against a word in a paragraph, and whatever
//! weights it picks it will one day rank a mention above a name. Tiers do not. An entry is filed by
//! the **kind** of evidence that matched it — its own name, its signature, its brief, its detail —
//! and a worse kind never outranks a better one however often it occurs.
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
use crate::sandbox::{TypeReference, ViewRefusal, catalogue_functions};

/// Which kind of thing an [entry](DocEntry) documents.
///
/// Two, because today's catalogue has two: a function a program calls, and a type its signatures
/// mention. A method is a third only once an arm hangs functions off the types they operate on,
/// which is a reshape a later stage makes; nothing here has to change when it does beyond a variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocKind {
    /// A function this language's SDK offers.
    Function,
    /// A type its signatures mention.
    Type,
}

/// The `kind` filter's spelling of [`DocKind::Function`].
const KIND_FUNCTION: &str = "function";
/// The `kind` filter's spelling of [`DocKind::Type`].
const KIND_TYPE: &str = "type";

impl DocKind {
    /// The word a filter names this kind by, and a hit reports it as.
    pub fn id(self) -> &'static str {
        match self {
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
/// A module filter accepts either, so a prompt naming gg's id and a model typing what it sees in the
/// hits both work.
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
    /// The key `openDocsView` takes — a bare name today, a fully-qualified one once arms carry
    /// modules.
    key: &'static str,
    /// Which kind of thing this is.
    kind: DocKind,
    /// The modules it belongs to, over the **whole** catalogue. Exactly one for a function; for a
    /// type, the modules of the functions that reference it, which is the only attribution today's
    /// catalogue can support and so may be several — or, for a type nothing references, none.
    ///
    /// Nothing reads this directly: both the `module` filter and what a hit reports go through
    /// [`modules_for`](Self::modules_for), which narrows it to the asking agent.
    modules: Vec<DocModule>,
    /// The name a program calls it by, or the type's own name.
    name: &'static str,
    /// The identity a function is filed under in this language's catalogue — `(object, key)` — which
    /// is what [`DocsRuntime::bound`](super::DocsRuntime::bound) is asked about. `None` for a type,
    /// whose visibility is decided by [`referenced_by`](Self::referenced_by) instead.
    identity: Option<(&'static str, &'static str)>,
    /// For a **type**, the positions of the function entries whose signatures reference it — the
    /// whole of how a type's visibility and its modules are derived. Empty for a function.
    referenced_by: Vec<usize>,
    /// The name reduced to what a comparison should ignore, by the same
    /// [fold](super::suggest) a failed lookup's hint uses — so a query for `write_file` finds
    /// `writeFile` on every arm that spells it that way.
    folded: String,
    /// The rendered signature text, joined across every shape this language offers the function in;
    /// for a type, its declaration. Lowercased.
    signature: String,
    /// The one-line brief, as authored.
    brief: &'static str,
    /// The brief, lowercased.
    brief_folded: String,
    /// The detail beneath the brief — everything the documentation says after its first line — with
    /// the brief itself removed, so a word in the brief is not also counted here. Lowercased.
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
/// The tier for a term in the rendered **signature**: a parameter name, an argument type.
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
/// of one arm's committed catalogue and building it forces that catalogue's parse — so a table
/// covering every arm would make the first search on any arm parse all eleven. Indexed by
/// [`ordinal`](GgProgramLanguage::ordinal), which is exactly what that method exists for.
///
/// It is **not** a committed artifact, and deliberately: the catalogue it is derived from is already
/// compiled into the binary, so a precomputed index would be a second copy of it — one that would
/// have to be regenerated, diffed and kept in step, for a build that takes microseconds over
/// forty-odd functions.
fn index(language: &'static dyn ProgramLanguage) -> &'static DocIndex {
    static INDEXES: [OnceLock<DocIndex>; GgProgramLanguage::COUNT] =
        [const { OnceLock::new() }; GgProgramLanguage::COUNT];
    INDEXES[language.id().ordinal()].get_or_init(|| DocIndex::build(language))
}

impl DocIndex {
    /// Build the index for one language from its committed catalogue.
    ///
    /// Functions first, then types, and the order matters: a type records the **positions** of the
    /// functions referencing it, which is how both its visibility and its modules are derived, and
    /// those positions have to exist before they can be recorded.
    ///
    /// A function gg has no [operation](crate::sandbox::operation_of) for is skipped rather than
    /// indexed under a fallback module. It could never be returned anyway —
    /// [`bound`](super::DocsRuntime::bound) refuses exactly those — and an entry no search can
    /// return is not an entry; inventing a module id for it would put a name in gg's cross-arm
    /// vocabulary that nothing on gg's side chose.
    fn build(language: &'static dyn ProgramLanguage) -> Self {
        let mut entries: Vec<DocEntry> = Vec::new();
        // The catalogue's own `types` list per function, kept beside the entry so the type pass can
        // ask which functions named it without walking the catalogue a second time.
        let mut references: Vec<&'static [TypeReference]> = Vec::new();
        for function in catalogue_functions(language) {
            let Some(operation) = crate::sandbox::operation_of(&function) else {
                continue;
            };
            let brief = function.prose.brief;
            entries.push(DocEntry {
                key: function.name,
                kind: DocKind::Function,
                modules: vec![DocModule {
                    id: operation.id.namespace,
                    path: function.object,
                }],
                name: function.name,
                identity: Some((function.object, function.key)),
                referenced_by: Vec::new(),
                folded: fold(function.name),
                signature: function
                    .signatures
                    .iter()
                    .map(|entry| entry.signature.as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
                    .to_lowercase(),
                brief,
                brief_folded: brief.to_lowercase(),
                detail_folded: function.prose.detail.unwrap_or_default().to_lowercase(),
            });
            references.push(function.types);
        }

        let functions = entries.len();
        for declaration in &language.catalogue().types {
            let name = declaration.name.as_str();
            // A reference resolves to the type's own key — its fully-qualified name where the arm
            // emits one, and its bare name where it does not — while what a model *reads* and
            // matches on stays the name the signature writes.
            let key = declaration.key();
            let referenced_by: Vec<usize> = (0..functions)
                .filter(|position| references[*position].iter().any(|kind| kind.fqn() == key))
                .collect();
            let mut modules: Vec<DocModule> = Vec::new();
            for position in &referenced_by {
                for module in &entries[*position].modules {
                    if !modules.contains(module) {
                        modules.push(*module);
                    }
                }
            }
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
    /// Restrict to one module, named by either gg's [id](DocModule::id) or this language's
    /// [path](DocModule::path). Case-insensitive, and **exact** — a module filter is a lookup.
    pub module: Option<&'a str>,
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
            Some(kind) if kind.eq_ignore_ascii_case(KIND_FUNCTION) => Some(DocKind::Function),
            Some(kind) if kind.eq_ignore_ascii_case(KIND_TYPE) => Some(DocKind::Type),
            Some(kind) => {
                return Err(ViewRefusal {
                    failure: ToolFailure::InvalidArgument,
                    message: format!(
                        "`{kind}` is not a kind of documentation entry; use \
                         `{KIND_FUNCTION}` or `{KIND_TYPE}`, or leave it out for both"
                    ),
                });
            }
        };
        let module = query.module.map(str::trim).filter(|it| !it.is_empty());
        let declared_type = query
            .declared_type
            .map(str::trim)
            .filter(|it| !it.is_empty());
        if terms.is_empty() && module.is_none() && declared_type.is_none() && kind.is_none() {
            return Err(ViewRefusal {
                failure: ToolFailure::InvalidArgument,
                message: "a search needs something to look for: a query, or a `module`, `type` or \
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
        let mut ranked: Vec<(Scored, &DocEntry, Vec<DocModule>)> = Vec::new();
        for (position, entry) in index.entries.iter().enumerate() {
            if !visible[position] {
                continue;
            }
            if kind.is_some_and(|kind| kind != entry.kind) {
                continue;
            }
            // Narrowed to this agent before it is either filtered on or reported, so the module a
            // hit says it lives in and the module a filter would have found it under are the same
            // answer. See `modules_for`.
            let modules = entry.modules_for(index, &visible);
            if module.is_some_and(|module| !in_module(&modules, module)) {
                continue;
            }
            if declared_type.is_some_and(|name| !index.concerns_type(position, name)) {
                continue;
            }
            // An empty query with a filter is a directory, so a filtered entry with nothing to score
            // against is a hit at the weakest tier — ranked, in that case, entirely by its key.
            let scored = match terms.is_empty() {
                true => Scored {
                    tier: TIER_DETAIL,
                    relevance: Relevance::default(),
                },
                false => match entry.score(&terms) {
                    Some(scored) => scored,
                    None => continue,
                },
            };
            ranked.push((scored, entry, modules));
        }
        ranked.sort_by(|(left, a, _), (right, b, _)| {
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
                .then(a.key.cmp(b.key))
        });

        let total = ranked.len();
        let hits = ranked
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .map(|(_, entry, modules)| entry.hit(&modules))
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
        for (position, entry) in index.entries.iter().enumerate() {
            if entry.kind == DocKind::Type {
                visible[position] = entry.referenced_by.iter().any(|at| visible[*at]);
            }
        }
        visible
    }
}

/// Where a kind sorts when everything else about two entries is equal: types before functions.
fn kind_bias(kind: DocKind) -> u8 {
    match kind {
        DocKind::Type => 0,
        DocKind::Function => 1,
    }
}

/// A count as the envelope reports it, saturating rather than wrapping — a catalogue is forty-odd
/// entries, so this can only ever be the identity, and saturating says that without an `as` cast
/// that would silently stop being one.
fn saturating(total: usize) -> u32 {
    u32::try_from(total).unwrap_or(u32::MAX)
}

/// Whether `modules` contains the one `filter` names, by gg's id or by this language's path.
/// Case-insensitive and exact: a module filter is a lookup, not a ranking.
fn in_module(modules: &[DocModule], filter: &str) -> bool {
    modules.iter().any(|module| {
        module.id.eq_ignore_ascii_case(filter) || module.path.eq_ignore_ascii_case(filter)
    })
}

impl DocEntry {
    /// The modules this entry belongs to **as the asking agent can see them** — the answer both the
    /// `module` filter and a [hit](Self::hit) are built from.
    ///
    /// A function's module is its own and is returned unchanged. A **type**'s is the union of the
    /// modules of every function referencing it, and that union is a property of the whole catalogue
    /// rather than of the agent asking: `ToolError` is referenced from `programs`, `skills` and
    /// `memory` as readily as from `fs`. Reported raw, an agent holding nothing but `read_file`
    /// would be told its one visible type lives in three modules it has not a single call in — and
    /// since a module name is the discovery vocabulary the prompt hands the model, it would then
    /// spend a turn on `search(module: "skills")` and read an empty page it cannot tell from
    /// *nothing matched*. So the union is narrowed by the same `visible` pass that decided the entry
    /// appears at all, which is also what keeps the filter and the report from disagreeing.
    fn modules_for(&self, index: &DocIndex, visible: &[bool]) -> Vec<DocModule> {
        match self.kind {
            DocKind::Function => self.modules.clone(),
            DocKind::Type => {
                let mut modules: Vec<DocModule> = Vec::new();
                for position in self.referenced_by.iter().filter(|at| visible[**at]) {
                    for module in &index.entries[*position].modules {
                        if !modules.contains(module) {
                            modules.push(*module);
                        }
                    }
                }
                modules
            }
        }
    }

    /// Score this entry against already-[normalized](normalize) `terms`, or `None` when no term
    /// matched any of its four fields.
    ///
    /// The entry's tier is the **best** any single term achieved, so one term landing on the name
    /// carries an entry that another term only brushed in a paragraph. Breadth and frequency are
    /// summed across every field, because they answer a different question from the tier: *how much
    /// of what you asked for is in here*, rather than *what kind of thing matched*.
    fn score(&self, terms: &[String]) -> Option<Scored> {
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
                false => relevance(&self.folded, std::slice::from_ref(&folded)),
            };
            let identifier_tier = if folded.is_empty() {
                None
            } else if self.folded == folded {
                Some(TIER_IDENTIFIER_EXACT)
            } else if self.folded.starts_with(&folded) {
                Some(TIER_IDENTIFIER_PREFIX)
            } else if identifier.is_match() {
                Some(TIER_IDENTIFIER_CONTAINS)
            } else {
                None
            };
            let term = std::slice::from_ref(term);
            let signature = relevance(&self.signature, term);
            let brief = relevance(&self.brief_folded, term);
            let detail = relevance(&self.detail_folded, term);
            let Some(term_tier) = identifier_tier
                .or_else(|| signature.is_match().then_some(TIER_SIGNATURE))
                .or_else(|| brief.is_match().then_some(TIER_BRIEF))
                .or_else(|| detail.is_match().then_some(TIER_DETAIL))
            else {
                continue;
            };
            matched += 1;
            occurrences += identifier.occurrences
                + signature.occurrences
                + brief.occurrences
                + detail.occurrences;
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

    /// This entry as a model reads it in a result list, in the modules
    /// [it can see](Self::modules_for).
    fn hit(&self, modules: &[DocModule]) -> DocHit {
        DocHit {
            key: self.key.to_string(),
            kind: self.kind,
            module: modules
                .iter()
                .map(|module| module.path)
                .collect::<Vec<_>>()
                .join(", "),
            name: self.name.to_string(),
            summary: self.brief.to_string(),
        }
    }
}

#[cfg(test)]
#[path = "docs.search.test.rs"]
mod tests;
