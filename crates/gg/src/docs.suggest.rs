//! What a failed documentation lookup offers instead of nothing: the bound names nearest the one
//! the model asked for.
//!
//! [`read`](super::DocsRuntime::read) answers a name it does not bind with `None`, and the refusal
//! that becomes — *no documentation for `write`* — is complete about the miss and silent about the
//! fix. Watching real code-mode turns, the miss is almost never a name the model invented. It is one
//! of three near-misses on a name that does exist:
//!
//! * the **gg tool name** where the program spelling belongs — `write_file` for `writeFile`, a
//!   confusion the model comes by honestly, since the tool name is what its telemetry, its prompt's
//!   capability lists and gg's own sentences call the same function;
//! * a **stem** — `write`, `read`, `open` — a name recalled by its first word and completed by
//!   guess;
//! * a **typo** in a name it has already used correctly.
//!
//! Every one of those is answerable from the very set the lookup just failed against, so this module
//! answers it, in the shape a compiler writes a hint: the closest bound names, on their own line
//! under the error.
//!
//! # Only names this agent binds
//!
//! The candidates are the bound ones — exactly the set [`read`](super::DocsRuntime::read) would have
//! answered from — and never the whole catalogue. Offering `editFile` to an agent whose run withheld
//! `edit_file` would trade a `not-found` the model can act on for a name that evaluates to
//! `undefined` on the turn it writes it, which is the one failure a directory must never cause.
//!
//! # Why the matching is tiered rather than scored
//!
//! A single blended score has to weigh a prefix against an edit distance, and whatever weights it
//! picks it will one day rank a typo above an exact match under another spelling. Tiers do not:
//! every candidate is placed in the *kind* of near-miss it is, only the best kind is ever offered,
//! and a worse kind is never promoted to fill the hint out.

/// The most names one hint offers.
///
/// A hint is a nudge, not a directory — `<object>.list()` is the directory, and the lookup's own
/// documentation already points at it — so this is what fits in a glance rather than what would be
/// complete. When more candidates than this sit in the winning tier the extras are dropped; nothing
/// from a worse tier is ever promoted in their place.
const MAX_SUGGESTIONS: usize = 3;

/// The length at or under which a name gets one edit of latitude rather than two.
///
/// Two edits inside `list` reaches `last`, `lint` and a good deal of the vocabulary; two inside
/// `searchMemories` reaches nothing that is not a typo of it. The threshold is where the second edit
/// stops being evidence and starts being noise.
const SHORT_NAME: usize = 4;

/// The bound names nearest `query`, best tier first, at most [`MAX_SUGGESTIONS`] of them — empty
/// when nothing is close enough to be worth saying.
///
/// `candidates` is the caller's bound set; this function neither knows nor asks what gated it. The
/// order is deterministic — tier, then the shorter name, then alphabetical — because a hint that
/// reshuffled between two identical failures would read as two different answers to one question.
pub(super) fn nearest<'a>(
    query: &str,
    candidates: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    let folded = fold(query);
    if folded.is_empty() {
        return Vec::new();
    }
    let mut scored: Vec<(u32, usize, &str)> = candidates
        .into_iter()
        .filter_map(|candidate| {
            tier(&folded, &fold(candidate)).map(|tier| (tier, candidate.len(), candidate))
        })
        .collect();
    scored.sort_unstable();
    let Some(&(best, ..)) = scored.first() else {
        return Vec::new();
    };
    scored
        .into_iter()
        .take_while(|(tier, ..)| *tier == best)
        .take(MAX_SUGGESTIONS)
        .map(|(.., name)| name.to_string())
        .collect()
}

/// A name reduced to what a comparison should ignore: the object a qualified guess carries, the
/// separators that distinguish a gg tool name from its program spelling, and case.
///
/// Dropping the qualifier is what makes `fs.writeFile` a hit rather than a miss, and dropping the
/// separators and case is what makes `write_file` one: both are the *right* function under the wrong
/// spelling, and a hint that could not see through a spelling would be blind to the commonest miss
/// there is. Everything else survives, so `writeFile` and `readFile` stay different names.
fn fold(name: &str) -> String {
    name.rsplit('.')
        .next()
        .unwrap_or(name)
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Which kind of near-miss `candidate` is for `query`, both already [folded](fold) — lower is
/// nearer — or `None` when it is no kind at all.
///
/// The three exact tiers are ordered by how sure they are: the same name under another spelling, a
/// name the query is the opening of, and a name one is somewhere inside the other of. Edit distance
/// sits below all of them and carries its own distance in the tier, so a one-character typo is
/// offered ahead of a two-character one and never beside it.
fn tier(query: &str, candidate: &str) -> Option<u32> {
    if query == candidate {
        return Some(0);
    }
    if candidate.starts_with(query) {
        return Some(1);
    }
    if candidate.contains(query) || query.contains(candidate) {
        return Some(2);
    }
    let edits = distance(query, candidate);
    let allowed = allowance(query.chars().count().min(candidate.chars().count()))?;
    (edits <= allowed).then(|| 3 + edits as u32)
}

/// How many single-character edits may separate two names of which the shorter has `shorter`
/// characters, or `None` when they are too short for an edit to be evidence of anything — inside a
/// two-character name one edit changes half of it, which makes every short name a near-miss for
/// every other.
fn allowance(shorter: usize) -> Option<usize> {
    match shorter {
        0..=2 => None,
        3..=SHORT_NAME => Some(1),
        _ => Some(2),
    }
}

/// The Levenshtein distance between two names: how many single-character insertions, deletions and
/// substitutions turn one into the other.
///
/// Two rows rather than the full matrix, and over `char`s rather than bytes — the names here are
/// ASCII identifiers, but a query is whatever the model wrote, and a distance computed over the
/// bytes of a multi-byte character is a number about an encoding rather than about a name.
fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current = vec![0; b.len() + 1];
    for (i, from) in a.iter().enumerate() {
        current[0] = i + 1;
        for (j, to) in b.iter().enumerate() {
            let substitute = previous[j] + usize::from(from != to);
            current[j + 1] = substitute.min(previous[j + 1] + 1).min(current[j] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[b.len()]
}

#[cfg(test)]
#[path = "docs.suggest.test.rs"]
mod tests;
