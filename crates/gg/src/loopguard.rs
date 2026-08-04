//! **Loop detection** — the rolling-window repetition detector that abandons a model reply which
//! has stopped being a reply and become a *period*.
//!
//! # The defect
//!
//! Some models, on some turns, stop generating an answer and start generating a cycle: the same
//! short fragment — `void 0;`, one row of a table, one call — emitted over and over until the
//! provider's own output cap ends it. Four things are lost at once, and gg can only avoid them
//! while the reply is still arriving:
//!
//! 1. **The money.** Output tokens are the expensive side, and a capped reply is the largest one
//!    the provider will sell.
//! 2. **The wall clock.** Tens of thousands of tokens take minutes, and the run's clock is the
//!    host's, not the model's.
//! 3. **The turn.** The reply is not a program and not a tool call; whatever the turn was for did
//!    not happen.
//! 4. **The next turn.** Worst of the four: the looping reply enters the context window, where it
//!    is the most recent and most repetitive thing the model can see, which makes the *following*
//!    turn more likely to do the same thing. A loop that is paid for is also a loop that is
//!    reinforced.
//!
//! Only the fourth is recoverable after the fact. The first three are why this detector reads the
//! reply **as it streams** rather than judging a completed one, and why arming it
//! ([`GgLoopDetection::enabled`]) is also what moves an agent onto the streaming transport.
//!
//! # The rule
//!
//! > **A reply is looping when several distinct words have each been over-represented in the recent
//! > window for a long, unbroken stretch of the reply.**
//!
//! Three terms, each doing a job no other one can:
//!
//! - **frequency** ([`repeat_threshold`](LoopGuardConfig::repeat_threshold)) — a word occurring more
//!   than `P` times in the last `N` is over-represented. Alone, this is the naive rule, and it fires
//!   on any dense literal.
//! - **breadth** ([`min_offenders`](LoopGuardConfig::min_offenders)) — a *single* very common token
//!   (`the`, `0,`, a brace) is ordinary text; a loop repeats a whole fragment, so it necessarily
//!   over-represents several words together. Requiring `M` of them at once is what distinguishes a
//!   repeated *phrase* from a common *word*.
//! - **persistence** ([`min_saturated_run`](LoopGuardConfig::min_saturated_run)) — the term this
//!   detector actually turns on, below.
//!
//! # Why the sustained-run term exists
//!
//! Frequency and breadth together still fire on the most ordinary thing a model writes for a game:
//! a tilemap literal. `0, 0, 1, 0, 0, 2, …` over fifteen hundred entries has two or three words
//! each occupying a third of any window you look at — it is, by the frequency rule, indistinguishable
//! from a loop. So is a long Markdown table, a colour palette, a list of waypoints, a wave
//! definition.
//!
//! What separates them is not *how* repetitive they are but **that they end**. Legitimate repetitive
//! data is a bounded region of a reply: the model writes its fifteen hundred tiles and then writes
//! `];` and carries on with the rest of the program. A loop has no such region — it saturates the
//! window and *never stops*, because there is nothing after it to write. So the detector does not
//! ask "is this stretch repetitive?", which cannot be answered correctly; it asks **"has this
//! stretch been repetitive for longer than any real data literal could be?"**, which can. That is
//! [`min_saturated_run`](LoopGuardConfig::min_saturated_run), and its default (3000 words) is
//! deliberately far beyond the largest literal a model plausibly writes, precisely so the detector
//! can be aggressive on the other two terms without ever discarding a reply that was merely dense.
//!
//! Note what this buys and what it costs: the detector is late by construction — it lets several
//! thousand words of a loop through before it acts. That is the right trade. The reply is already
//! being abandoned at a fraction of the output cap, and the alternative — tripping early — is a
//! detector that deletes the model's tilemap and reports a loop that never happened.
//!
//! # What `min_saturated_run: 0` gives up
//!
//! Zero is legal and means "trip the moment the window is both full and saturated" — the unmodified
//! frequency rule, with none of the paragraph above. An operator who sets it is choosing to
//! **discard any reply containing a large data literal**, because such a reply is not distinguishable
//! from a loop by frequency and breadth alone. It exists because a study measuring the frequency
//! rule itself needs to be able to ask for it, and because a model known to emit no literals at all
//! can be watched more tightly. It is not a tuning knob to reach for when the defaults feel slow.
//!
//! # Words, and the cap on one
//!
//! A "word" here is a whitespace-separated run of characters, terminated by whitespace and never
//! counted before it is — an identifier that arrives split across three stream chunks is one word,
//! not three, which is the whole reason the pending run is buffered rather than the chunk being
//! tokenised on its own. A reply's final partial word is therefore never counted at all, which
//! costs nothing: a reply that ends is not looping.
//!
//! A run that never terminates would otherwise be one unbounded word — a whitespace-free loop
//! (`a();a();a();…`) would defeat both the memory bound and the detection — so a pending run is
//! flushed as a word at [`MAX_WORD_CHARS`]. Such a "word" is a **fixed-width slice of the stream**
//! rather than a lexical word, and that is exactly what makes a periodic whitespace-free loop
//! detectable: a repeating period cut at a fixed width yields a small, fixed set of slices that
//! recur, which the frequency rule sees as ordinary offenders.
//!
//! # Pure, and network-free
//!
//! Nothing here opens a connection, reads a clock, allocates a buffer proportional to the reply, or
//! knows what a model is. [`LoopGuard`] takes `&str` chunks and returns a [verdict](LoopVerdict);
//! the transport that abandons the request, the retry that follows, and the log line that reports it
//! belong to the [client](crate::client), on exactly the terms [`limits`](crate::limits) decides
//! ceilings without ending anything. Memory is bounded by the window: `N` hashes and at most `N` map
//! entries, whatever the words were, because the window stores 64-bit hashes rather than the words
//! themselves.

use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, VecDeque};
use std::fmt;
use std::hash::{Hash, Hasher};

use test_cabinet_core::gg::GgLoopDetection;

// ---------------------------------------------------------------------------------------------
// The knobs
// ---------------------------------------------------------------------------------------------

/// The widest a single pending word may grow before it is flushed as one anyway: **128 characters**.
///
/// Two jobs, and the second is the interesting one. It bounds the detector's memory against a reply
/// that contains no whitespace at all, and it turns a whitespace-free periodic loop into something
/// the frequency rule can see: cutting a repeating period at a fixed width produces a small set of
/// slices that recur, where the uncut run would have been a single ever-growing word that occurs
/// exactly once.
///
/// 128 is comfortably above any identifier, URL or base64 line a model writes as one token run
/// (so an ordinary reply is tokenised lexically and this never fires), and comfortably below the
/// point where a slice stops recurring often enough to be counted.
pub const MAX_WORD_CHARS: usize = 128;

/// The lookback the detector's frequency rule is measured over when a run declares none: **256
/// words**.
///
/// Wide enough that a genuinely repeated *phrase* has room to repeat several times inside it, and
/// narrow enough that a region of a long reply is judged on its own terms rather than diluted by
/// the thousands of ordinary words around it — which matters because a loop always begins partway
/// through a reply that started out fine.
pub const DEFAULT_WINDOW_WORDS: usize = 256;

/// How many times one word may occur in the window before it counts as an offender when a run
/// declares nothing: **32**, i.e. a single word occupying more than an eighth of the default
/// window.
///
/// Ordinary prose puts its commonest word (`the`) at around 6% of a passage and ordinary source
/// puts its commonest token well under that, so an eighth is several times above anything a reply
/// that is *saying something* reaches — while a two-word period saturates it after 66 words.
pub const DEFAULT_REPEAT_THRESHOLD: u32 = 32;

/// How many distinct offenders must be present at once for the window to count as saturated when a
/// run declares nothing: **2**.
///
/// One is not enough, and the reason is structural rather than empirical: a lone over-represented
/// token is what a common word *is*. A loop repeats a fragment, and a fragment is more than one
/// word, so it over-represents its words together. Two is the smallest number that expresses
/// "a phrase, not a word", and raising it further mainly delays detection of short periods.
pub const DEFAULT_MIN_OFFENDERS: usize = 2;

/// How many consecutive words must arrive while the window stays saturated before the reply is
/// abandoned, when a run declares nothing: **3000 words**.
///
/// The term that separates a loop from legitimately repetitive content (see the
/// [module docs](self)), and the number is chosen against the largest literal a model plausibly
/// writes: a 64×64 tilemap is 4096 entries, so this sits at roughly a 55×55 map. Below that, a
/// reply's data literal ends and the saturation with it; above it, nothing that terminates has ever
/// been observed. It is deliberately generous — a false trip deletes the model's work, while a late
/// trip costs a few thousand words of a reply that was going to be thrown away regardless.
pub const DEFAULT_MIN_SATURATED_RUN: usize = 3000;

/// The hard ceiling on one reply's length when a run declares none: **250 000 characters**.
///
/// The backstop for a runaway that is *not* repetitive enough to trip the window rule — a model
/// that generates novel garbage rather than a period. Sized well above any legitimate reply
/// (a 2000-line program is around 60 000 characters) and well below a provider's output cap, so it
/// only ever fires on a reply nothing was going to use.
pub const DEFAULT_MAX_RESPONSE_CHARS: usize = 250_000;

/// The largest window reserved up front, whatever the configuration asked for: **4096 words**.
///
/// [`window_words`](LoopGuardConfig::window_words) is a *ceiling*, and a ceiling may legitimately be
/// declared as something no reply could reach — [`resolve_loop_guard`] deliberately saturates an
/// over-wide declaration to `usize::MAX` rather than wrapping it small. Reserving that literally
/// would abort the process on a knob that was never nonsensical, so the reservation is capped and
/// the deque grows on demand for the (unreachable) rest. Sized well above the default window, so no
/// realistic configuration ever reallocates.
const MAX_RESERVED_WINDOW: usize = 4096;

/// The resolved knobs one [`LoopGuard`] enforces.
///
/// `Copy`, because a resolved detector configuration is five scalars that every reply is judged
/// against identically and none of them mutates. Constructed from a run's
/// [declaration](GgLoopDetection) by [`resolve_loop_guard`], which is the only place a nonsensical
/// value is turned into a default and a warning — by the time a value is in this struct it is
/// simply what the detector does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LoopGuardConfig {
    /// `N` — how many of the most recent words the frequency rule looks back over.
    ///
    /// Also the minimum sample: the repetition rule cannot fire until the window has actually
    /// observed `N` words, so a reply is never judged on a window it has not filled.
    pub window_words: usize,
    /// `P` — a word is an **offender** when it occurs **strictly more** than this many times inside
    /// the window. Raising it tolerates denser legitimate repetition at the cost of seeing a loop
    /// later.
    pub repeat_threshold: u32,
    /// `M` — how many distinct offenders must be present at once for the window to count as
    /// **saturated**.
    pub min_offenders: usize,
    /// `R` — how many consecutive words must arrive while the window stays saturated before the
    /// reply is abandoned. `0` trips as soon as a full window is saturated — the plain frequency
    /// rule, and everything the [module docs](self) say it gives up.
    pub min_saturated_run: usize,
    /// The hard ceiling on one reply's length, in characters. `0` turns the backstop **off** and
    /// leaves only the repetition rule.
    pub max_response_chars: usize,
}

impl Default for LoopGuardConfig {
    /// gg's own defaults — every knob a run leaves undeclared, each justified on its own constant.
    fn default() -> Self {
        Self {
            window_words: DEFAULT_WINDOW_WORDS,
            repeat_threshold: DEFAULT_REPEAT_THRESHOLD,
            min_offenders: DEFAULT_MIN_OFFENDERS,
            min_saturated_run: DEFAULT_MIN_SATURATED_RUN,
            max_response_chars: DEFAULT_MAX_RESPONSE_CHARS,
        }
    }
}

impl LoopGuardConfig {
    /// The one `info` line a run with the detector armed logs at launch, naming the configuration in
    /// force.
    ///
    /// The counterpart of [`RunLimits::armed_summary`](crate::limits::RunLimits::armed_summary) and
    /// [`HealingConfig::armed_summary`](crate::healing::HealingConfig::armed_summary), emitted for
    /// the same reason: loop detection changes an agent's *transport* as well as its policy, and an
    /// operator reading a log should not have to infer either from the absence of a message. There
    /// is no "disarmed" spelling here because a disarmed detector resolves to no configuration at
    /// all — the [caller](resolve_loop_guard) has nothing to summarise.
    pub fn armed_summary(&self) -> String {
        let repetition = if self.min_saturated_run == 0 {
            format!(
                "as soon as {} or more words have each occurred more than {} times in the last {}",
                self.min_offenders, self.repeat_threshold, self.window_words
            )
        } else {
            format!(
                "after {} consecutive words during which {} or more words have each occurred more \
                 than {} times in the last {}",
                self.min_saturated_run,
                self.min_offenders,
                self.repeat_threshold,
                self.window_words
            )
        };
        if self.max_response_chars == 0 {
            return format!(
                "loop detection: armed — a reply is abandoned {repetition}; there is no length \
                 backstop"
            );
        }
        format!(
            "loop detection: armed — a reply is abandoned {repetition}, or once it passes {} \
             characters",
            self.max_response_chars
        )
    }
}

// ---------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------

/// What one [pushed](LoopGuard::push) chunk amounted to.
///
/// Deliberately a two-state answer rather than a score: the caller's only decision is whether to
/// keep reading the stream, and a detector that returned a confidence would push that decision onto
/// every call site instead of settling it here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopVerdict {
    /// Nothing so far says this reply is looping. Keep reading.
    Continue,
    /// Abandon the reply: it is looping. Carries [what tripped](LoopTrip) it, for the operator's log
    /// line and for the error a reply that loops on every attempt ends as.
    Looping(LoopTrip),
}

/// Which rule abandoned a reply, and the figures that make the log line say something.
///
/// Both variants carry their *observations* rather than their thresholds: the configuration is
/// already logged once at launch, and what an operator wants from the trip line is what the reply
/// was actually doing when it was dropped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopTrip {
    /// The repetition rule: [`min_saturated_run`](LoopGuardConfig::min_saturated_run) consecutive
    /// words arrived while at least [`min_offenders`](LoopGuardConfig::min_offenders) distinct words
    /// each exceeded [`repeat_threshold`](LoopGuardConfig::repeat_threshold) occurrences within the
    /// last [`window_words`](LoopGuardConfig::window_words).
    Repetition {
        /// How many distinct words were over-represented in the window at the moment of the trip.
        offenders: usize,
        /// How many consecutive words had arrived with the window saturated — the term that says
        /// this was a loop rather than a data literal.
        saturated_run: usize,
        /// How far into the reply, in words, the trip happened.
        words: u64,
    },
    /// The length backstop: the reply passed
    /// [`max_response_chars`](LoopGuardConfig::max_response_chars) without finishing.
    Length {
        /// How many characters had arrived when the backstop fired.
        chars: usize,
    },
}

impl fmt::Display for LoopTrip {
    /// The operator-facing sentence, used both in the `warn` line for a discarded attempt and in the
    /// error a reply that looped on every attempt ends as — one spelling, so the log and the failure
    /// cannot describe the same event differently.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Repetition {
                offenders,
                saturated_run,
                words,
            } => write!(
                f,
                "{offenders} words repeated across {saturated_run} consecutive words, {words} \
                 words into the reply"
            ),
            Self::Length { chars } => {
                write!(f, "the reply passed {chars} characters without finishing")
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The detector
// ---------------------------------------------------------------------------------------------

/// Rolling-window repetition detector over a model's streamed reply.
///
/// One guard watches one reply: it is fed the stream's text deltas in order with [`push`](Self::push)
/// and answers, after each, whether the reply is still worth reading. It holds no connection, no
/// clock and no model — see the [module docs](self) for the rule it enforces and why it is shaped
/// the way it is.
///
/// A guard that has tripped is **inert**: every later push returns the same trip, counts nothing
/// further and cannot panic, so a caller that finishes draining a chunk it had already started, or
/// that pushes once more before breaking, gets a stable answer rather than a second verdict.
pub struct LoopGuard {
    /// The knobs this reply is judged against, resolved once for the run.
    config: LoopGuardConfig,
    /// The word currently being assembled — characters seen since the last whitespace, not yet
    /// counted. Never counted until whitespace terminates it or it reaches [`MAX_WORD_CHARS`],
    /// which is what makes an identifier split across stream chunks one word rather than several.
    pending: String,
    /// [`pending`](Self::pending)'s length in **characters**, kept alongside it because the cap is
    /// a character cap and `String::len` is bytes — and because recounting on every character would
    /// make word assembly quadratic in the word's length.
    pending_len: usize,
    /// The last [`window_words`](LoopGuardConfig::window_words) word hashes, oldest first.
    ///
    /// Hashes rather than the words themselves: the rule only ever asks whether two words are the
    /// same one, so memory is `N × 8` bytes whatever the reply contained. A 64-bit collision would
    /// merge two words' counts, which at a window of a few hundred is far below the noise floor of
    /// a heuristic whose thresholds are in the dozens.
    window: VecDeque<u64>,
    /// How many times each hash currently in the [window](Self::window) occurs in it. Entries are
    /// removed at zero, so this map is never larger than the window.
    ///
    /// A [`BTreeMap`] rather than a hash map, because gg keys every map in its own code on `Ord`
    /// (see `no_unordered_map_or_set_survives_in_ggs_own_code`) so that nothing about a recorded run
    /// depends on a per-process hash seed. Nothing here iterates the map — every access is a lookup
    /// by hash — so the ordering costs a comparison per probe and buys the guarantee that two runs
    /// of the same reply detect the same loop.
    counts: BTreeMap<u64, u32>,
    /// How many entries of [`counts`](Self::counts) currently exceed
    /// [`repeat_threshold`](LoopGuardConfig::repeat_threshold).
    ///
    /// Maintained **incrementally** — adjusted only when a count crosses the threshold in either
    /// direction — rather than recomputed by scanning the map. That is what keeps the detector at
    /// O(1) per word: the map is scanned zero times per reply, however long the reply is.
    offenders: usize,
    /// How many consecutive words have arrived with the window saturated. Reset to zero by the
    /// first word that arrives while it is not, because the rule is about an *unbroken* stretch.
    saturated_run: usize,
    /// Completed words seen in this reply — reported for the log line, and the `words` a repetition
    /// trip is stamped with.
    words_seen: u64,
    /// Characters pushed into this guard, whatever they were — the figure the
    /// [length backstop](LoopGuardConfig::max_response_chars) is measured against. Characters
    /// rather than bytes, so a reply is judged the same way whatever alphabet it is written in.
    chars_seen: usize,
    /// The trip that ended this reply, once one has. Its presence is what makes the guard inert.
    tripped: Option<LoopTrip>,
}

impl LoopGuard {
    /// A fresh guard for one reply, judging it against `config`.
    ///
    /// The window is reserved up front — its size is its own bound, and a guard is created once per
    /// model attempt rather than per chunk, so the allocation is paid once and never grown. The
    /// reservation is capped at [`MAX_RESERVED_WINDOW`], because a window declared wider than any
    /// reply could fill is a legal ceiling but not a legal allocation.
    pub fn new(config: LoopGuardConfig) -> Self {
        let reserve = config.window_words.min(MAX_RESERVED_WINDOW);
        Self {
            config,
            pending: String::with_capacity(MAX_WORD_CHARS),
            pending_len: 0,
            window: VecDeque::with_capacity(reserve),
            // No reservation: a `BTreeMap` has no `with_capacity`, and it allocates per node on
            // demand — which is why the window's own reservation above is the one that matters.
            counts: BTreeMap::new(),
            offenders: 0,
            saturated_run: 0,
            words_seen: 0,
            chars_seen: 0,
            tripped: None,
        }
    }

    /// Feed one streamed text delta, and answer whether the reply is still worth reading.
    ///
    /// Returns [`Looping`](LoopVerdict::Looping) the **first** time a rule trips, and the same trip
    /// for every push after that (see [`LoopGuard`] on inertness). An empty chunk, and a chunk that
    /// is nothing but whitespace, are no-ops beyond the characters they contribute: neither can
    /// complete a word that was not already complete.
    ///
    /// The repetition rule is evaluated on each completed word, so a chunk containing many words is
    /// judged word by word and stops at the first that trips; the
    /// [length backstop](LoopGuardConfig::max_response_chars) is evaluated once, after the chunk. A
    /// chunk that would satisfy both is therefore reported as the repetition it is, which is the
    /// more informative of the two answers.
    pub fn push(&mut self, chunk: &str) -> LoopVerdict {
        if let Some(trip) = self.tripped {
            return LoopVerdict::Looping(trip);
        }

        for ch in chunk.chars() {
            self.chars_seen += 1;

            if ch.is_whitespace() {
                if let Some(trip) = self.flush_word() {
                    return self.record(trip);
                }
                continue;
            }

            self.pending.push(ch);
            self.pending_len += 1;
            // The cap, not a word boundary: the pending run is flushed as a fixed-width slice so a
            // whitespace-free reply is still made of countable pieces. See [`MAX_WORD_CHARS`].
            if self.pending_len >= MAX_WORD_CHARS
                && let Some(trip) = self.flush_word()
            {
                return self.record(trip);
            }
        }

        if self.config.max_response_chars > 0 && self.chars_seen > self.config.max_response_chars {
            return self.record(LoopTrip::Length {
                chars: self.chars_seen,
            });
        }

        LoopVerdict::Continue
    }

    /// Completed words seen so far — a reply's final partial word is deliberately not among them.
    pub fn words_seen(&self) -> u64 {
        self.words_seen
    }

    /// Characters seen so far, counted as characters rather than bytes.
    pub fn chars_seen(&self) -> usize {
        self.chars_seen
    }

    /// Complete the [pending](Self::pending) word, if there is one, and fold it into the window.
    ///
    /// `None` when there was nothing pending — which is the common case for whitespace, since
    /// indentation, blank lines and the space after a newline all arrive as runs of whitespace with
    /// no word between them, and none of them may contribute a word.
    fn flush_word(&mut self) -> Option<LoopTrip> {
        if self.pending.is_empty() {
            return None;
        }
        let hash = hash_word(&self.pending);
        self.pending.clear();
        self.pending_len = 0;
        self.observe(hash)
    }

    /// Fold one completed word into the window and re-evaluate the repetition rule.
    ///
    /// The whole O(1)-per-word core: one push, one count increment, at most one eviction with its
    /// count decrement, and the two threshold crossings those can cause. The map is never scanned.
    fn observe(&mut self, hash: u64) -> Option<LoopTrip> {
        self.words_seen += 1;

        self.window.push_back(hash);
        let count = self.counts.entry(hash).or_insert(0);
        *count += 1;
        // The crossing *into* offender status — saturating, so a threshold no count could ever
        // reach cannot be reached by arithmetic either.
        if *count == self.config.repeat_threshold.saturating_add(1) {
            self.offenders += 1;
        }

        // The push above can put the window one over size, so the oldest word is dropped here and
        // its count drops with it. Written as one block because the eviction is what the length
        // test is *for*.
        if self.window.len() > self.config.window_words
            && let Some(evicted) = self.window.pop_front()
            && let Some(count) = self.counts.get_mut(&evicted)
        {
            *count -= 1;
            // The crossing back *out* of offender status, the exact mirror of the one above.
            if *count == self.config.repeat_threshold {
                self.offenders -= 1;
            }
            if *count == 0 {
                self.counts.remove(&evicted);
            }
        }

        let saturated = self.offenders >= self.config.min_offenders;
        if saturated {
            self.saturated_run += 1;
        } else {
            self.saturated_run = 0;
        }

        // Three conditions, and each is load-bearing. Saturation *now* — without it a
        // `min_saturated_run` of zero would be satisfied by a run of zero and trip on any full
        // window. The sustained run — the term that tells a loop from a data literal. And a window
        // that has actually observed `N` words, because a rule about the last `N` words must not be
        // answered by fewer.
        (saturated
            && self.saturated_run >= self.config.min_saturated_run
            && self.window.len() >= self.config.window_words)
            .then_some(LoopTrip::Repetition {
                offenders: self.offenders,
                saturated_run: self.saturated_run,
                words: self.words_seen,
            })
    }

    /// Latch `trip` and report it — the single place a guard becomes inert.
    fn record(&mut self, trip: LoopTrip) -> LoopVerdict {
        self.tripped = Some(trip);
        LoopVerdict::Looping(trip)
    }

    /// How many words the window currently holds. Test-only: the eviction bound is a property of
    /// the algorithm rather than of its output, so it is asserted directly instead of inferred.
    #[cfg(test)]
    fn window_len(&self) -> usize {
        self.window.len()
    }

    /// How many distinct words the count map currently tracks. Test-only, for the same reason: a
    /// map that outgrows the window is a leak no verdict would reveal.
    #[cfg(test)]
    fn tracked_words(&self) -> usize {
        self.counts.len()
    }

    /// How many times `word` currently occurs in the window. Test-only.
    #[cfg(test)]
    fn count_of(&self, word: &str) -> u32 {
        self.counts.get(&hash_word(word)).copied().unwrap_or(0)
    }

    /// How many distinct offenders the window currently holds. Test-only: it is what "saturated"
    /// means, and a negative test wants to assert a reply never came near saturation rather than
    /// merely that it did not trip.
    #[cfg(test)]
    fn offenders(&self) -> usize {
        self.offenders
    }

    /// The current unbroken saturated run. Test-only: the tilemap case passes *because* this climbs
    /// high and stops, which is a stronger thing to assert than "no trip".
    #[cfg(test)]
    fn saturated_run(&self) -> usize {
        self.saturated_run
    }
}

/// The 64-bit identity of one word.
///
/// `DefaultHasher` because the window needs equality, not cryptography or distribution guarantees,
/// and because it is deterministic for a given build — the same reply produces the same counts on
/// every run, which is what makes a detector heuristic reproducible in a test.
fn hash_word(word: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    word.hash(&mut hasher);
    hasher.finish()
}

// ---------------------------------------------------------------------------------------------
// Configuration resolution
// ---------------------------------------------------------------------------------------------

/// The outcome of reading an agent's [loop-detection declaration](GgLoopDetection): the detector to
/// run, if any, and everything an operator should be told about how it was read.
pub struct ResolvedLoopGuard {
    /// The knobs to watch this agent's replies with, or `None` when the detector is **off** — which
    /// is also what keeps that agent on gg's ordinary non-streaming transport.
    pub config: Option<LoopGuardConfig>,
    /// Operator-facing warnings, in declaration order. The caller's to emit, on the same terms as
    /// [`resolve_run_limits`](crate::limits::resolve_run_limits)'s: this function is pure, and the
    /// loop logs them on the root's stream before the first turn.
    pub warnings: Vec<String>,
}

/// Resolve one agent's [detector](LoopGuardConfig) from its declaration, appending a warning for
/// every knob that cannot do its job.
///
/// **Total**, exactly as [`resolve_run_limits`](crate::limits::resolve_run_limits) is: a zero or
/// nonsensical knob resolves to gg's default plus a warning, never to an error, so a sweep's one
/// shared configuration document stays interpretable by every arm. No warning ever fails a launch.
///
/// | Declaration | Resolves to | Warning |
/// | --- | --- | --- |
/// | `enabled: false`, or absent | the detector is **off**; the agent keeps the non-streaming transport | — |
/// | `enabled: true`, no knobs | gg's [defaults](LoopGuardConfig::default) | — |
/// | `windowWords: 0` | [`DEFAULT_WINDOW_WORDS`] | a window of no words has nothing to look back over |
/// | `repeatThreshold: 0` | [`DEFAULT_REPEAT_THRESHOLD`] | every word would be an offender, so no reply could be told from a loop |
/// | `minOffenders: 0` | [`DEFAULT_MIN_OFFENDERS`] | a window with no offenders in it would count as saturated |
/// | `minOffenders` > `windowWords` | **armed as declared** | the window cannot hold that many distinct words, so only the length backstop can fire |
/// | `minSaturatedRun: 0` | `0` — the plain frequency rule | — (a deliberate choice; see the [module docs](self)) |
/// | `maxResponseChars: 0` | the backstop is **off** | — |
///
/// The two zero values that are *not* warned about are the two that mean something: a saturated-run
/// of zero is the unmodified frequency rule, and a length backstop of zero turns the backstop off.
/// The cross-knob check is warned about but **armed** rather than defaulted, on the same terms
/// `errorRateWindow >= maxTurns` is: which of the two knobs the operator meant is not knowable, and
/// silently replacing one of them would hide the mistake rather than report it.
///
/// A declaration with `enabled: false` produces no warnings at all, whatever its knobs say. Nothing
/// is going to read them, and a warning about a value that will never be used is noise in the one
/// log an operator reads to find out what a run was actually configured to do.
pub fn resolve_loop_guard(declared: &GgLoopDetection) -> ResolvedLoopGuard {
    let mut warnings = Vec::new();
    if !declared.is_armed() {
        return ResolvedLoopGuard {
            config: None,
            warnings,
        };
    }

    let window_words = as_usize(positive_knob(
        declared.window_words,
        DEFAULT_WINDOW_WORDS as u64,
        "windowWords",
        "a window of no words has nothing to look back over",
        &mut warnings,
    ));
    let repeat_threshold = as_u32(positive_knob(
        declared.repeat_threshold,
        u64::from(DEFAULT_REPEAT_THRESHOLD),
        "repeatThreshold",
        "every word would count as an offender, so no reply could be told apart from a loop",
        &mut warnings,
    ));
    let min_offenders = as_usize(positive_knob(
        declared.min_offenders,
        DEFAULT_MIN_OFFENDERS as u64,
        "minOffenders",
        "a window with no offenders in it would count as saturated",
        &mut warnings,
    ));

    // Cross-knob, and therefore armed rather than defaulted: a window of `N` words holds at most
    // `N` distinct words, so a demand for more offenders than that can never be met and the
    // repetition rule is silently inert. Said out loud, with both figures, because the operator's
    // mistake is in the relationship rather than in either value.
    if min_offenders > window_words {
        warnings.push(format!(
            "minOffenders ({min_offenders}) is larger than windowWords ({window_words}), so the \
             repetition rule can never fire; only the length backstop is left."
        ));
    }

    // The two knobs whose zero *means* something, so they take the declaration as written and warn
    // about nothing: a saturated run of zero is the plain frequency rule, and a length backstop of
    // zero is off. Reading them through the same `unwrap_or` as the others keeps "absent takes gg's
    // default" one rule rather than two.
    let min_saturated_run = as_usize(
        declared
            .min_saturated_run
            .unwrap_or(DEFAULT_MIN_SATURATED_RUN as u64),
    );
    let max_response_chars = as_usize(
        declared
            .max_response_chars
            .unwrap_or(DEFAULT_MAX_RESPONSE_CHARS as u64),
    );

    ResolvedLoopGuard {
        config: Some(LoopGuardConfig {
            window_words,
            repeat_threshold,
            min_offenders,
            min_saturated_run,
            max_response_chars,
        }),
        warnings,
    }
}

/// Read one knob whose zero cannot bound anything: absent takes `default` silently, zero takes it
/// with a warning naming the knob and saying what a zero would have meant, and anything else stands.
///
/// One helper rather than three `match`es so the three warnings are worded the same way and a fourth
/// knob of the same shape cannot be added with a differently shaped sentence.
fn positive_knob(
    declared: Option<u64>,
    default: u64,
    knob: &str,
    consequence: &str,
    warnings: &mut Vec<String>,
) -> u64 {
    match declared {
        Some(0) => {
            warnings.push(format!(
                "{knob}: 0 cannot bound anything ({consequence}); the detector uses its default of \
                 {default}."
            ));
            default
        }
        Some(value) => value,
        None => default,
    }
}

/// Narrow a declared knob to this platform's `usize`, saturating rather than wrapping.
///
/// A declaration wider than a `usize` is a knob no reply could ever reach, and keeping the
/// operator's intent ("effectively never") is better than silently arming a small ceiling — the
/// same rule [`resolve_run_limits`](crate::limits::resolve_run_limits) applies to every count it
/// narrows.
fn as_usize(value: u64) -> usize {
    usize::try_from(value).unwrap_or(usize::MAX)
}

/// Narrow a declared knob to a `u32`, saturating rather than wrapping, for the same reason
/// [`as_usize`] does.
fn as_u32(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[cfg(test)]
#[path = "loopguard.test.rs"]
mod tests;
