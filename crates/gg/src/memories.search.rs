//! The [keyword-search](super::MemoryStrategy::KeywordSearch) strategy's retrieval: how a set of
//! keywords is turned into a ranked list of memories.
//!
//! It is deliberately the simplest thing that can work — case-insensitive substring counting,
//! ranked by how many of the caller's keywords a memory matches and then by how often — because
//! the strategy is a *hypothesis about agents*, not a search-engine benchmark. An embedding index
//! or a stemmer would confound the question it exists to ask (can an agent work from memory it has
//! to look up?) with a question about retrieval quality, and would put a model's results at the
//! mercy of a similarity threshold nobody in the study chose.
//!
//! Two consequences are worth stating because they are choices, not accidents:
//!
//! * **A memory's name and description are searched along with its body.** A model that names a
//!   memory well should be able to find it by that name, and a slug that never matched would be a
//!   trap.
//! * **Matching a keyword at all outranks matching one many times.** Breadth is the better signal:
//!   a memory mentioning every keyword once is far more likely to be the one asked for than a
//!   memory that repeats one of them twenty times.

use super::Memory;

/// The number of characters of context an [excerpt](excerpt_around) keeps on each side of the
/// match — enough to see the sentence the keyword sits in without turning a result list into the
/// memories themselves.
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
pub fn normalize_keywords(keywords: &[String]) -> Vec<String> {
    let mut normalized: Vec<String> = Vec::new();
    for keyword in keywords {
        let keyword = keyword.trim().to_lowercase();
        if !keyword.is_empty() && !normalized.contains(&keyword) {
            normalized.push(keyword);
        }
    }
    normalized
}

/// Rank `memories` against already-[normalized](normalize_keywords) `keywords`, best first,
/// keeping at most `limit` of them (`None` keeps every match).
///
/// Memories matching no keyword at all are dropped rather than ranked last: a zero-score result is
/// noise in a list a model is going to read.
pub fn rank(memories: &[Memory], keywords: &[String], limit: Option<usize>) -> Vec<MemoryHit> {
    let mut hits: Vec<MemoryHit> = memories
        .iter()
        .filter_map(|memory| score(memory, keywords))
        .collect();
    // Breadth first, then frequency, then the slug — so an identical pair of scores always ranks
    // the same way and a search is reproducible across runs.
    hits.sort_by(|a, b| {
        b.matched
            .cmp(&a.matched)
            .then(b.occurrences.cmp(&a.occurrences))
            .then(a.name.cmp(&b.name))
    });
    if let Some(limit) = limit {
        hits.truncate(limit);
    }
    hits
}

/// Score one memory against the keywords, or `None` when it matches none of them.
fn score(memory: &Memory, keywords: &[String]) -> Option<MemoryHit> {
    // The searchable text is the whole record — a memory found by its own name is the point.
    let haystack = format!(
        "{} {} {}",
        memory.name(),
        memory.description(),
        memory.body()
    )
    .to_lowercase();

    let mut matched = 0;
    let mut occurrences = 0;
    let mut first_at: Option<usize> = None;
    for keyword in keywords {
        let count = haystack.matches(keyword.as_str()).count();
        if count == 0 {
            continue;
        }
        matched += 1;
        occurrences += count;
        if let Some(at) = haystack.find(keyword.as_str()) {
            first_at = Some(first_at.map_or(at, |earliest: usize| earliest.min(at)));
        }
    }
    if matched == 0 {
        return None;
    }

    // The excerpt is cut from the *body* at the same offset the lowercased haystack matched, minus
    // the name/description prefix the haystack prepended. A match inside that prefix (the memory
    // was found by its slug) has no body offset, so the excerpt simply starts at the top.
    let prefix = memory.name().chars().count() + memory.description().chars().count() + 2;
    let body_at = first_at
        .map(|at| haystack[..at].chars().count())
        .and_then(|at| at.checked_sub(prefix))
        .unwrap_or(0);

    Some(MemoryHit {
        name: memory.name().to_string(),
        description: memory.description().to_string(),
        matched,
        occurrences,
        excerpt: excerpt_around(memory.body(), body_at),
    })
}

/// A single-line window of `text` around character offset `at`, elided on either side when it does
/// not reach the ends.
///
/// Newlines are collapsed to spaces: an excerpt is one line in a list of results, and a memory's
/// own paragraph breaks would make that list unreadable.
fn excerpt_around(text: &str, at: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    let start = at.saturating_sub(EXCERPT_RADIUS);
    let end = (at + EXCERPT_RADIUS).min(chars.len());
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
#[path = "memories.search.test.rs"]
mod tests;
