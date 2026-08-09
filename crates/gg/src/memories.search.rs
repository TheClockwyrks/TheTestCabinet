//! The [keyword-search](super::MemoryStrategy::KeywordSearch) strategy's retrieval: how a set of
//! keywords is turned into a ranked list of memories.
//!
//! The matching, the ranking and the excerpting are gg's [shared substring core](crate::search),
//! which was lifted out of this file when the [documentation surface](crate::docs) needed the same
//! thing. What is left here is what is *about memories*: which text is searched, how much of the
//! body an excerpt keeps, and the [hit](MemoryHit) a model reads.
//!
//! Two consequences are worth stating because they are choices, not accidents:
//!
//! * **A memory's name and description are searched along with its body.** A model that names a
//!   memory well should be able to find it by that name, and a slug that never matched would be a
//!   trap.
//! * **Matching a keyword at all outranks matching one many times.** Breadth is the better signal:
//!   a memory mentioning every keyword once is far more likely to be the one asked for than a
//!   memory that repeats one of them twenty times. That is
//!   [`breadth_then_frequency`](crate::search::breadth_then_frequency), and it is now the same
//!   ordering documentation search uses.

use super::Memory;
use crate::search::{Relevance, breadth_then_frequency, excerpt_around, normalize, relevance};

/// The number of characters of context an [excerpt](crate::search::excerpt_around) keeps on each
/// side of the match — enough to see the sentence the keyword sits in without turning a result list
/// into the memories themselves.
///
/// It stays here rather than moving into the shared core with the function that reads it, because
/// how much of a *memory* is enough to recognise one by is a judgement about memories.
const EXCERPT_RADIUS: usize = 80;

/// One memory a [search](super::MemoryStore::search) matched, with the numbers it was ranked by.
///
/// Owned rather than borrowed from the store: the store is behind a `Mutex` the tool releases
/// before rendering its result, so a hit that borrowed would keep the lock across the formatting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryHit {
    /// The memory's slug — the handle `read_memory` takes.
    pub name: String,
    /// The memory's description, or empty when it was created without one.
    pub description: String,
    /// How many **distinct** keywords this memory matched — the primary ranking.
    pub matched: usize,
    /// How many times those keywords occur in total — the tiebreak.
    pub occurrences: usize,
    /// A short window of the memory around its first match, for judging relevance without
    /// reading the whole thing.
    pub excerpt: String,
}

/// Normalize the caller's keywords: trimmed, lowercased, de-duplicated, empties dropped.
///
/// Returns an empty vector when nothing usable survives, which the caller reports as a bad call
/// rather than as a search that matched nothing — "you gave me no keywords" and "no memory
/// mentions these" are different answers and the model needs to be able to tell them apart.
///
/// Each keyword is normalized **whole**: this call takes a list, and one entry of it may
/// legitimately be a phrase the model wants matched as one, so nothing here splits on whitespace.
/// (A [documentation](crate::docs) search takes one query string and splits it before normalizing,
/// which is the same [primitive](crate::search::normalize) given a different separation.)
pub fn normalize_keywords(keywords: &[String]) -> Vec<String> {
    normalize(keywords.iter().map(String::as_str))
}

/// Rank `memories` against already-[normalized](normalize_keywords) `keywords`, best first,
/// keeping at most `limit` of them (`None` keeps every match).
///
/// Memories matching no keyword at all are dropped rather than ranked last: a zero-score result is
/// noise in a list a model is going to read.
pub fn rank(memories: &[Memory], keywords: &[String], limit: Option<usize>) -> Vec<MemoryHit> {
    let mut scored: Vec<(Relevance, MemoryHit)> = memories
        .iter()
        .filter_map(|memory| score(memory, keywords))
        .collect();
    // Breadth first, then frequency, then the slug — so an identical pair of scores always ranks
    // the same way and a search is reproducible across runs. The first two are the shared core's;
    // the slug is this search's own stable key, which is the half the core has nothing to say about.
    scored.sort_by(|(left, a), (right, b)| {
        breadth_then_frequency(left, right).then(a.name.cmp(&b.name))
    });
    let mut hits: Vec<MemoryHit> = scored.into_iter().map(|(_, hit)| hit).collect();
    if let Some(limit) = limit {
        hits.truncate(limit);
    }
    hits
}

/// Score one memory against the keywords, or `None` when it matches none of them.
fn score(memory: &Memory, keywords: &[String]) -> Option<(Relevance, MemoryHit)> {
    // The searchable text is the whole record — a memory found by its own name is the point.
    let haystack = format!(
        "{} {} {}",
        memory.name(),
        memory.description(),
        memory.body()
    );
    let scored = relevance(&haystack, keywords);
    if !scored.is_match() {
        return None;
    }

    // The excerpt is cut from the *body* at the same character offset the haystack matched at, minus
    // the name/description prefix the haystack prepended. A match inside that prefix (the memory
    // was found by its slug) has no body offset, so the excerpt simply starts at the top.
    let prefix = memory.name().chars().count() + memory.description().chars().count() + 2;
    let body_at = scored
        .first_at
        .and_then(|at| at.checked_sub(prefix))
        .unwrap_or(0);

    Some((
        scored,
        MemoryHit {
            name: memory.name().to_string(),
            description: memory.description().to_string(),
            matched: scored.matched,
            occurrences: scored.occurrences,
            excerpt: excerpt_around(memory.body(), body_at, EXCERPT_RADIUS),
        },
    ))
}

#[cfg(test)]
#[path = "memories.search.test.rs"]
mod tests;
