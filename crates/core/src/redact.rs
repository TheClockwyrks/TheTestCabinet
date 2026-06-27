//! Secret redaction for the public-egress boundaries.
//!
//! A run executes with a real provider API key in its container, and a model
//! that dumps its environment (or a harness that echoes a failing request) can
//! print that key into the recorded event stream, an error detail, or a file it
//! writes. The backend that ingests those events is private and trusted, so the
//! captured data keeps full fidelity there. The danger is only at the two points
//! where a run's data is published to the open internet:
//!
//! - the public per-run GitHub repository the implementation is released to
//!   ([`publish`](crate::publish)), and
//! - the public R2 snapshot the site is built from (the backend's snapshot
//!   builder).
//!
//! This module is the shared scrubber both seams run their outbound data through.
//! It redacts two ways:
//!
//! 1. **Exact literals** — the actual key values, when the caller has them. The
//!    publisher runs on the operator's host, so it can harvest the keys the run
//!    used straight from the environment ([`SecretScrubber::from_host_env`]) and
//!    redact those exact strings with no false positives. The backend never holds
//!    a key value, so it relies on (2) alone.
//! 2. **Provider-shaped tokens** — `sk-…` keys (Anthropic's `sk-ant-…`,
//!    OpenRouter's `sk-or-…`, OpenAI's `sk-proj-…`/`sk-…`) recognized by shape and
//!    length. This catches a leaked key whose value the scrubber was never told,
//!    including keys that came from somewhere other than our own injection.
//!
//! Redaction is deliberately conservative — anchored to the `sk-` provider prefix
//! and a generous length floor — so it does not rewrite ordinary prose or source
//! that merely contains a short `sk-` substring. Matches are replaced with
//! [`PLACEHOLDER`].

use std::borrow::Cow;

/// What a redacted secret is replaced with in published text.
pub const PLACEHOLDER: &str = "[REDACTED]";

/// Shortest literal value worth treating as a secret. A handful of characters
/// would match far too much ordinary text; real keys are long, so a floor here
/// guards against a stray short value in the environment scrubbing the whole
/// document to placeholders.
const MIN_LITERAL_LEN: usize = 12;

/// Shortest token body (the part after the `sk-` prefix) for a `sk-…` run to be
/// treated as a key. Provider keys are far longer than this; the floor keeps a
/// short identifier like `sk-test` from being redacted.
const MIN_KEY_BODY_LEN: usize = 16;

/// Whether `b` can appear inside a provider key token. Keys are ASCII
/// alphanumerics plus `-`/`_` (covering `sk-ant-`, `sk-or-`, base64url bodies).
fn is_token_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'-' || b == b'_'
}

/// Redacts secrets from text bound for a public destination.
///
/// Construct with [`SecretScrubber::new`] for shape-based redaction only, or
/// [`SecretScrubber::from_host_env`]/[`SecretScrubber::with_literals`] to also
/// redact known exact key values. Cheap to clone-free reuse across many strings.
#[derive(Debug, Clone, Default)]
pub struct SecretScrubber {
    /// Exact secret values to redact, longest first so a key that contains
    /// another (unlikely, but cheap to be safe) is replaced whole before its
    /// substring is considered.
    literals: Vec<String>,
}

impl SecretScrubber {
    /// A scrubber that redacts only provider-shaped tokens (no known literals).
    /// This is the backend/R2 configuration: the snapshot builder has the
    /// captured text but never the key values that produced it.
    pub fn new() -> Self {
        Self::default()
    }

    /// A scrubber that also redacts each of `literals` as an exact substring,
    /// in addition to provider-shaped tokens. Values shorter than
    /// [`MIN_LITERAL_LEN`], or blank, are ignored.
    pub fn with_literals(literals: impl IntoIterator<Item = String>) -> Self {
        let mut literals: Vec<String> = literals
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| s.len() >= MIN_LITERAL_LEN)
            .collect();
        // Longest first, then dedup so identical values collapse.
        literals.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        literals.dedup();
        Self { literals }
    }

    /// A scrubber seeded with the API-key values currently set in the host
    /// environment across every built-in harness — the keys a run on this host
    /// would have used — for exact-match redaction when releasing source
    /// publicly. See [`crate::harness_registry::host_api_key_values`].
    pub fn from_host_env() -> Self {
        Self::with_literals(crate::harness_registry::host_api_key_values())
    }

    /// Redact every secret occurrence in `text`, returning the original borrowed
    /// when nothing matched so the common clean case allocates nothing.
    pub fn scrub<'a>(&self, text: &'a str) -> Cow<'a, str> {
        let mut current = Cow::Borrowed(text);
        // Exact literals first: a key value may not match the `sk-` shape, and
        // redacting it whole avoids leaving a recognizable fragment behind.
        for literal in &self.literals {
            if current.contains(literal.as_str()) {
                current = Cow::Owned(current.replace(literal.as_str(), PLACEHOLDER));
            }
        }
        match scrub_key_shaped(&current) {
            Some(replaced) => Cow::Owned(replaced),
            None => current,
        }
    }

    /// Redact secrets in every string anywhere inside a JSON value, in place.
    /// Returns whether anything changed, so a caller can log that a published
    /// document carried a redacted secret. This is how the backend scrubs a
    /// per-run snapshot document (record + events) before upload.
    pub fn scrub_json(&self, value: &mut serde_json::Value) -> bool {
        match value {
            serde_json::Value::String(s) => match self.scrub(s) {
                Cow::Owned(replaced) => {
                    *s = replaced;
                    true
                }
                Cow::Borrowed(_) => false,
            },
            serde_json::Value::Array(items) => {
                let mut changed = false;
                for item in items {
                    changed |= self.scrub_json(item);
                }
                changed
            }
            serde_json::Value::Object(map) => {
                let mut changed = false;
                for (_, v) in map.iter_mut() {
                    changed |= self.scrub_json(v);
                }
                changed
            }
            _ => false,
        }
    }
}

/// Replace every `sk-…` provider-shaped token in `text` with [`PLACEHOLDER`],
/// returning `None` when there was nothing to replace (so the caller can avoid
/// allocating). A token qualifies when it starts at a token boundary with the
/// literal `sk-` and runs for at least [`MIN_KEY_BODY_LEN`] further token bytes —
/// covering `sk-ant-…`, `sk-or-…`, `sk-proj-…`, and bare `sk-…` keys in one rule.
fn scrub_key_shaped(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out: Option<String> = None;
    let mut copied = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        // Only start a token at a boundary so we match whole tokens, never the
        // tail of a longer one. A preceding multibyte (non-ASCII) byte is not a
        // token byte, so it correctly reads as a boundary.
        let at_boundary = i == 0 || !is_token_byte(bytes[i - 1]);
        if at_boundary && bytes[i..].starts_with(b"sk-") {
            let mut j = i;
            while j < bytes.len() && is_token_byte(bytes[j]) {
                j += 1;
            }
            // `i` sits on the ASCII `s` and `j` on a non-token (or end) byte, so
            // both are UTF-8 char boundaries: the slices below cannot split a
            // character.
            if j - i >= "sk-".len() + MIN_KEY_BODY_LEN {
                let out = out.get_or_insert_with(String::new);
                out.push_str(&text[copied..i]);
                out.push_str(PLACEHOLDER);
                copied = j;
            }
            i = j;
            continue;
        }
        i += 1;
    }
    if let Some(out) = out.as_mut() {
        out.push_str(&text[copied..]);
    }
    out
}

#[cfg(test)]
#[path = "redact.test.rs"]
mod tests;
