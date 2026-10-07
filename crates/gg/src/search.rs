//! The substring-relevance core two of gg's searches share: how a caller's words are normalized,
//! how one piece of text is scored against them, and how equally-good candidates are put in a
//! stable order.
//!
//! It was lifted out of the [memory](crate::memories) keyword strategy when the
//! [documentation surface](crate::docs) needed the same thing, and it is deliberately the same
//! simplest-thing-that-works it was there: **case-insensitive substring counting**, ranked by how
//! many of the caller's terms a candidate matches and only then by how often. An embedding index or
//! a stemmer would put a model's results at the mercy of a similarity threshold nobody in the study
//! chose, and would confound the questions the two searches exist to ask (*can an agent work from
//! memory it has to look up?*, *can an agent find a function nothing named to it?*) with a question
//! about retrieval quality.
//!
//! # What is shared, and what deliberately is not
//!
//! Shared: **normalization** ([`normalize`]), **scoring one text against the terms**
//! ([`relevance`]), the **ordering** ([`breadth_then_frequency`]), and **excerpting**
//! ([`excerpt_around`]).
//!
//! Not shared: *which* text is scored, and *what a field being matched is worth*. Memories score one
//! haystack made of the whole record, because a memory is prose and every part of it is the same
//! kind of evidence. Documentation scores several fields separately and files the entry in a
//! [tier](crate::docs) by which one matched, because an identifier matching is not the same evidence
//! as a paragraph mentioning the word. Folding that into this module would mean one of the two
//! callers passing weights it does not believe in.
//!
//! # The ordering, and why it is the way round it is
//!
//! **Matching a term at all outranks matching one many times.** Breadth is the better signal: a
//! candidate mentioning every term once is far more likely to be the one asked for than one that
//! repeats a single term twenty times. Frequency is the tiebreak, and after it the caller adds a
//! **stable key** of its own — a memory's slug, a function's key — so that two candidates that score
//! identically always come back in the same order and a search is reproducible across runs. That
//! last part is not a nicety: a cross-language study compares runs, and a ranking that reshuffled
//! under an equal score would put noise in the comparison.

use std::cmp::Ordering;

/// Normalize a caller's search terms: each trimmed, lowercased, de-duplicated, empties dropped.
///
/// Returns an empty vector when nothing usable survives, which every caller reports as a bad call
/// rather than as a search that matched nothing — *you gave me nothing to look for* and *nothing
/// here mentions these* are different answers, and a model needs to be able to tell them apart.
///
/// It takes an iterator of already-separated terms rather than one string, because the two callers
/// separate them differently and neither separation is the other's to make. A
/// [memory](crate::memories) search is given a **list** of keywords and one of them may legitimately
/// be a phrase, so its terms arrive whole; a [documentation](crate::docs) search is given one query
/// **string**, because a substring search over identifiers is something a model types as a line, and
/// it splits on whitespace before it gets here.
pub fn normalize<'a>(terms: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut normalized: Vec<String> = Vec::new();
    for term in terms {
        let term = term.trim().to_lowercase();
        if !term.is_empty() && !normalized.contains(&term) {
            normalized.push(term);
        }
    }
    normalized
}

/// How one piece of text matched a set of [normalized](normalize) terms.
///
/// A [`matched`](Self::matched) of zero is a candidate that matched nothing, and every caller drops
/// those rather than ranking them last: a zero-score entry is noise in a list a model is going to
/// read, and a page of them would push a real hit off the end of a paginated result.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Relevance {
    /// How many **distinct** terms this text matched — the primary ranking.
    pub matched: usize,
    /// How many times those terms occur in it in total — the tiebreak.
    pub occurrences: usize,
    /// The character offset of the **earliest** match within the lowercased text, or `None` when
    /// there was none.
    ///
    /// In characters rather than bytes because it addresses a position a caller then cuts an
    /// [excerpt](excerpt_around) around, and an excerpt cut at a byte offset would split a
    /// multi-byte character.
    pub first_at: Option<usize>,
}

impl Relevance {
    /// Whether this text matched anything at all.
    pub fn is_match(&self) -> bool {
        self.matched > 0
    }
}

/// Score `text` against already-[normalized](normalize) `terms`: how many of them it contains, how
/// often in total, and where the first one starts.
///
/// The match is **case-insensitive substring** — `str::contains` over a lowercased copy — which is
/// what makes `foobar` find `getFoobar`, and is the whole of the matching rule in both searches. It
/// is not a word-boundary match on purpose: an identifier is a run of words with no separators a
/// tokenizer could agree on across eleven languages, so a boundary rule would be right for prose and
/// wrong for the thing this is mostly used on.
pub fn relevance(text: &str, terms: &[String]) -> Relevance {
    let haystack = text.to_lowercase();
    let mut relevance = Relevance::default();
    for term in terms {
        let count = haystack.matches(term.as_str()).count();
        if count == 0 {
            continue;
        }
        relevance.matched += 1;
        relevance.occurrences += count;
        if let Some(at) = haystack.find(term.as_str()) {
            // Counted in characters over the prefix that precedes the match, which is what an
            // excerpt is cut in.
            let at = haystack[..at].chars().count();
            relevance.first_at = Some(relevance.first_at.map_or(at, |earliest| earliest.min(at)));
        }
    }
    relevance
}

/// Order two candidates by **breadth, then frequency** — best first — and nothing else.
///
/// The caller appends its own stable key with [`Ordering::then`], because what makes two entries
/// distinguishable is the caller's business and this module has no key of its own to offer. A
/// documentation search puts a tier ahead of this call for the same reason.
pub fn breadth_then_frequency(left: &Relevance, right: &Relevance) -> Ordering {
    right
        .matched
        .cmp(&left.matched)
        .then(right.occurrences.cmp(&left.occurrences))
}

/// A single-line window of `text` around character offset `at`, keeping `radius` characters on each
/// side and elided with `…` on whichever side does not reach an end.
///
/// Newlines are collapsed to spaces: an excerpt is one line in a list of results, and the material's
/// own paragraph breaks would make that list unreadable.
///
/// The radius is the caller's rather than a constant here, because it is a judgement about the
/// material being excerpted — how much of a memory is enough to recognise it by is not the same
/// question as how much of anything else is.
pub fn excerpt_around(text: &str, at: usize, radius: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    let start = at.saturating_sub(radius);
    let end = (at + radius).min(chars.len());
    let window: String = chars[start..end].iter().collect();
    let window = window.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut excerpt = String::new();
    if start > 0 {
        excerpt.push('…');
    }
    excerpt.push_str(&window);
    if end < chars.len() {
        excerpt.push('…');
    }
    excerpt
}

#[cfg(test)]
#[path = "search.test.rs"]
mod tests;
