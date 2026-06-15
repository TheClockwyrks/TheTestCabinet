//! Reviews: a run's hand-written writeup and the quality rating that goes with
//! it.
//!
//! See `docs/results.md` and `docs/site.md`. A review is curatorial — authored
//! by a person after playing a finished build, not emitted by the run — so it is
//! deliberately **not** part of the [run record](crate::run_record) contract. It
//! lives beside a run as `writeup.md`, a Markdown file whose YAML frontmatter
//! carries the [`Rating`] and whose body is the prose shown before the playable
//! build. Publishing requires one (see [`crate::publish`]).
//!
//! The rating tiers here are mirrored as a TypeScript union in
//! `apps/site/src/data/ratings.ts`; keep the two in lockstep.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// A reviewer's subjective quality rating for a finished implementation.
///
/// Assigned by hand while playing the build, ordered best to worst. It is a
/// per-run signal shown alongside a run, never an aggregate or a ranking across
/// runs (see `docs/site.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Rating {
    /// Implemented according to spec with no noticeable bugs.
    Flawless,
    /// Implemented according to spec; may have minor issues that don't impact
    /// playability.
    Great,
    /// Mostly implemented according to spec. Playable, but deviates from the
    /// spec or has bugs that impact playability.
    Scuffed,
    /// Doesn't follow the spec, or has bugs severe enough to render the game
    /// unplayable.
    Broken,
}

impl Rating {
    /// Every rating, ordered best to worst.
    pub const ALL: [Rating; 4] = [
        Rating::Flawless,
        Rating::Great,
        Rating::Scuffed,
        Rating::Broken,
    ];

    /// The wire token for this rating, matching its frontmatter and serde form.
    pub fn as_str(&self) -> &'static str {
        match self {
            Rating::Flawless => "flawless",
            Rating::Great => "great",
            Rating::Scuffed => "scuffed",
            Rating::Broken => "broken",
        }
    }

    /// Parse a rating from its lowercase token, accepting surrounding whitespace
    /// and any case.
    pub fn parse(token: &str) -> Option<Rating> {
        match token.trim().to_ascii_lowercase().as_str() {
            "flawless" => Some(Rating::Flawless),
            "great" => Some(Rating::Great),
            "scuffed" => Some(Rating::Scuffed),
            "broken" => Some(Rating::Broken),
            _ => None,
        }
    }
}

/// A parsed review: a [`Rating`] and the writeup prose it accompanies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Writeup {
    /// The reviewer's quality rating.
    pub rating: Rating,
    /// The writeup body — the Markdown prose shown before the playable build,
    /// with the frontmatter stripped and surrounding whitespace trimmed.
    pub body: String,
}

impl Writeup {
    /// Render this review to its canonical `writeup.md` file contents: a
    /// `rating` frontmatter block followed by the body.
    ///
    /// Reconstructing the file from the parsed parts normalizes whatever spacing
    /// the author used, so every published writeup has identical framing.
    pub fn to_file_string(&self) -> String {
        format!(
            "---\nrating: {}\n---\n\n{}\n",
            self.rating.as_str(),
            self.body
        )
    }
}

/// Parse a `writeup.md` file: its `rating` frontmatter and its prose body.
///
/// The file must open with a `---` fenced YAML frontmatter block containing a
/// `rating` key set to one of the [`Rating`] tiers, and must have a non-empty
/// body after the frontmatter. Anything else is an [`Error::Review`] explaining
/// what was missing — this is what the publish gate reports.
pub fn parse_writeup(raw: &str) -> Result<Writeup> {
    let (frontmatter, body) = split_frontmatter(raw)?;

    let rating_value = frontmatter_value(frontmatter, "rating")
        .ok_or_else(|| Error::Review("writeup frontmatter is missing a `rating`".to_string()))?;
    let rating = Rating::parse(rating_value).ok_or_else(|| {
        Error::Review(format!(
            "writeup `rating` must be one of flawless, great, scuffed, broken (got `{}`)",
            rating_value.trim()
        ))
    })?;

    let body = body.trim();
    if body.is_empty() {
        return Err(Error::Review(
            "writeup has no body — add the report prose after the frontmatter".to_string(),
        ));
    }

    Ok(Writeup {
        rating,
        body: body.to_string(),
    })
}

/// Split a Markdown document into its leading `---` frontmatter block and the
/// body that follows. Returns an [`Error::Review`] when no frontmatter is found.
fn split_frontmatter(raw: &str) -> Result<(&str, &str)> {
    // Tolerate a UTF-8 BOM and leading blank lines before the opening fence.
    let trimmed = raw.trim_start_matches('\u{feff}').trim_start();
    let after_open = trimmed
        .strip_prefix("---\n")
        .or_else(|| trimmed.strip_prefix("---\r\n"))
        .ok_or_else(|| {
            Error::Review(
                "writeup is missing its `---` frontmatter block with a `rating`".to_string(),
            )
        })?;

    // The closing fence is a line that is exactly `---`. Walk the lines tracking
    // each one's byte offset so the body can be split off after the fence.
    let mut offset = 0;
    for line in after_open.split_inclusive('\n') {
        if line.trim_end_matches('\n').trim_end_matches('\r') == "---" {
            let frontmatter = &after_open[..offset];
            let body = &after_open[offset + line.len()..];
            return Ok((frontmatter, body));
        }
        offset += line.len();
    }

    Err(Error::Review(
        "writeup frontmatter is not closed with a `---` line".to_string(),
    ))
}

/// Look up a `key: value` entry in a frontmatter block, returning the raw value.
fn frontmatter_value<'a>(frontmatter: &'a str, key: &str) -> Option<&'a str> {
    frontmatter.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim() == key {
            Some(value)
        } else {
            None
        }
    })
}

#[cfg(test)]
#[path = "review.test.rs"]
mod tests;
