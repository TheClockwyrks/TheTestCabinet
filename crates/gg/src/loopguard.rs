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
//! [`min_saturated_run`](LoopGuardConfig::min_saturated_run), and a profile that arms this detector
//! sets it far beyond the largest literal its model plausibly writes — a 64×64 tilemap is 4096
//! entries — precisely so the detector can be aggressive on the other two terms without ever
//! discarding a reply that was merely dense.
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
//! can be watched more tightly. It is not a tuning knob to reach for when a detector feels slow.
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

/// The largest window reserved up front, whatever the configuration asked for: **4096 words**.
///
/// [`window_words`](LoopGuardConfig::window_words) is a *ceiling*, and a ceiling may legitimately be
/// declared as something no reply could reach — [`resolve_loop_guard`] deliberately saturates an
/// over-wide declaration to `usize::MAX` rather than wrapping it small. Reserving that literally
/// would abort the process on a knob that was never nonsensical, so the reservation is capped and
/// the deque grows on demand for the (unreachable) rest. Sized well above any window a profile
/// plausibly declares, so no realistic configuration ever reallocates.
const MAX_RESERVED_WINDOW: usize = 4096;

/// The resolved knobs one [`LoopGuard`] enforces — all five of them, every one written by the
/// profile whose replies they judge.
///
/// `Copy`, because a resolved detector configuration is five scalars that every reply is judged
/// against identically and none of them mutates. There is no [`Default`]: what the rule trips on is
/// the five terms *together*, so a detector holding a figure nobody chose would be measuring gg
/// rather than the model, and [`resolve_loop_guard`] refuses the launch instead of building one. By
/// the time a value is in this struct it is simply what the detector does.
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
    ///
    /// `None` is also what an armed declaration short of a knob resolves to, and there it is the
    /// [named placeholder](NO_DETECTOR_ON_A_REFUSED_LAUNCH) rather than a setting: nothing runs
    /// under it, because the report it came back beside refuses the launch.
    pub config: Option<LoopGuardConfig>,
    /// Operator-facing warnings, in declaration order — today the one cross-knob relationship gg
    /// arms exactly as declared and still has something to say about. The caller's to emit, on the
    /// same terms as [`resolve_run_limits`](crate::limits::resolve_run_limits)'s: this function is
    /// pure, and the loop logs them on the root's stream before the first turn.
    pub warnings: Vec<String>,
}

/// **The detector a profile runs once its declaration has been refused**: none.
///
/// [`resolve_loop_guard`] stays [total](crate::validate#the-resolver-contract) — it is called again
/// on every transfer and every spawn, and none of those callers may grow error handling for a
/// condition the launch pass has already made impossible — so a refused declaration still hands back
/// a value. This is that value, named rather than spelled `None` at the site so the next reader can
/// tell it apart from the `None` that means the profile switched the detector off. Nothing is ever
/// watched by it: the run is over before a reply arrives.
const NO_DETECTOR_ON_A_REFUSED_LAUNCH: Option<LoopGuardConfig> = None;

/// Resolve one agent's [detector](LoopGuardConfig) from its declaration.
///
/// **Total**, and refusing rather than falling back, exactly as
/// [`resolve_run_limits`](crate::limits::resolve_run_limits) is. gg substitutes nothing: an **armed**
/// detector writes all five knobs, because what the rule trips on is the five terms together, and a
/// detector armed on figures nobody chose measures gg rather than the model — a run comparing two of
/// them would be comparing one of them with itself. A knob an armed declaration leaves out, and a
/// knob that is present and cannot bound anything, are each reported to `report`, which refuses the
/// launch.
///
/// | Declaration | Resolves to |
/// | --- | --- |
/// | `enabled: false`, or absent | the detector is **off**; the agent keeps the non-streaming transport |
/// | `enabled: true`, all five knobs written | the detector those five knobs describe |
/// | `enabled: true`, any knob absent | **refused**, naming each knob that is missing |
/// | `minSaturatedRun: 0` | `0` — the plain frequency rule (a deliberate choice; see the [module docs](self)) |
/// | `maxResponseChars: 0` | the backstop is **off** |
/// | `minOffenders` > `windowWords` | **armed as declared**, plus a warning: only the length backstop can fire |
/// | `windowWords: 0`, `repeatThreshold: 0` or `minOffenders: 0` | **refused** |
///
/// The two zeroes that resolve are the two that *mean* something: a saturated run of zero is the
/// unmodified frequency rule, and a length backstop of zero turns the backstop off. Both are still
/// written by an armed declaration — "off" is a figure the profile chose, and its absence is not.
/// The cross-knob row is armed rather than refused on the same terms `errorRateWindow >= maxTurns`
/// is: both numbers are honoured to the letter, and which of the two the operator meant is not
/// knowable.
///
/// **An unarmed declaration owes nothing and is still read.** It requires no knob — there is no
/// detector for one to be missing from — but a knob it *does* write is judged exactly as an armed
/// one's is, because a disarmed declaration is still configuration: it records the detector the
/// armed arm would have run, and a typo in it is a typo an operator wants told about now rather than
/// on the launch where they flip the switch. The *warning* is the other way round: it says a run's
/// detector is inert, so a run with no detector at all has nothing for it to be about.
pub fn resolve_loop_guard(
    declared: &GgLoopDetection,
    report: &mut crate::validate::LaunchReport,
) -> ResolvedLoopGuard {
    let armed = declared.is_armed();
    let mut warnings = Vec::new();

    let window_words = positive_knob(
        declared.window_words,
        armed,
        KNOB_WINDOW_WORDS,
        "the lookback the frequency rule is measured over",
        "a window of no words has nothing to look back over",
        report,
    )
    .and_then(|value| as_usize(value, KNOB_WINDOW_WORDS, report));
    let repeat_threshold = positive_knob(
        declared.repeat_threshold,
        armed,
        KNOB_REPEAT_THRESHOLD,
        "how often one word may occur in the window before it counts as an offender",
        "every word would count as an offender, so no reply could be told apart from a loop",
        report,
    )
    .and_then(|value| as_u32(value, KNOB_REPEAT_THRESHOLD, report));
    let min_offenders = positive_knob(
        declared.min_offenders,
        armed,
        KNOB_MIN_OFFENDERS,
        "how many distinct offenders make the window saturated",
        "a window with no offenders in it would count as saturated",
        report,
    )
    .and_then(|value| as_usize(value, KNOB_MIN_OFFENDERS, report));

    // The two knobs whose zero *means* something, so they take the declaration as written: a
    // saturated run of zero is the plain frequency rule, and a length backstop of zero is off. Both
    // are read through the same reader as the other three, which is what makes "an armed detector
    // writes all five" one rule rather than two — a profile that wants either behaviour writes the
    // zero that says so.
    let min_saturated_run = read_knob(
        declared.min_saturated_run,
        armed,
        KNOB_MIN_SATURATED_RUN,
        "how long the window must stay saturated before a reply is abandoned",
        report,
    )
    .and_then(|value| as_usize(value, KNOB_MIN_SATURATED_RUN, report));
    let max_response_chars = read_knob(
        declared.max_response_chars,
        armed,
        KNOB_MAX_RESPONSE_CHARS,
        "the hard ceiling on one reply's length",
        report,
    )
    .and_then(|value| as_usize(value, KNOB_MAX_RESPONSE_CHARS, report));

    // Cross-knob, and therefore armed rather than refused: a window of `N` words holds at most
    // `N` distinct words, so a demand for more offenders than that can never be met and the
    // repetition rule is silently inert. Said out loud, with both figures, because the operator's
    // mistake is in the relationship rather than in either value — and said only for a detector
    // that is actually running, because it is a statement about what this run's detector can do.
    if armed
        && let (Some(min_offenders), Some(window_words)) = (min_offenders, window_words)
        && min_offenders > window_words
    {
        warnings.push(format!(
            "{KNOB_MIN_OFFENDERS} ({min_offenders}) is larger than {KNOB_WINDOW_WORDS} \
             ({window_words}), so the repetition rule can never fire; only the length backstop is \
             left."
        ));
    }

    let config = if !armed {
        // Off is off. The knobs above were still read and still judged; what a disarmed profile
        // does not get is a detector.
        None
    } else if let (
        Some(window_words),
        Some(repeat_threshold),
        Some(min_offenders),
        Some(min_saturated_run),
        Some(max_response_chars),
    ) = (
        window_words,
        repeat_threshold,
        min_offenders,
        min_saturated_run,
        max_response_chars,
    ) {
        Some(LoopGuardConfig {
            window_words,
            repeat_threshold,
            min_offenders,
            min_saturated_run,
            max_response_chars,
        })
    } else {
        NO_DETECTOR_ON_A_REFUSED_LAUNCH
    };

    ResolvedLoopGuard { config, warnings }
}

/// Every agent profile's [loop-detection declaration](GgLoopDetection), read for the
/// [launch pass](crate::validate::validate_launch).
///
/// Per profile rather than per run: the detector is a per-agent (and therefore per-model) lever, so
/// a knob is refused against the agent that wrote it. The advisory warning is dropped here — the
/// orchestrator emits it, once, on the root's stream.
pub fn check_launch(
    set: &test_cabinet_core::gg::GgCapabilitySet,
    report: &mut crate::validate::LaunchReport,
) {
    for agent in &set.agents {
        report.for_agent(&agent.slug, |report| {
            resolve_loop_guard(&agent.loop_detection, report);
        });
    }
}

/// The [window](LoopGuardConfig::window_words) knob, as the declaration spells it.
const KNOB_WINDOW_WORDS: &str = "windowWords";

/// The [offender threshold](LoopGuardConfig::repeat_threshold) knob, as the declaration spells it.
const KNOB_REPEAT_THRESHOLD: &str = "repeatThreshold";

/// The [saturation](LoopGuardConfig::min_offenders) knob, as the declaration spells it.
const KNOB_MIN_OFFENDERS: &str = "minOffenders";

/// The [sustained-run](LoopGuardConfig::min_saturated_run) knob, as the declaration spells it.
const KNOB_MIN_SATURATED_RUN: &str = "minSaturatedRun";

/// The [length backstop](LoopGuardConfig::max_response_chars) knob, as the declaration spells it.
const KNOB_MAX_RESPONSE_CHARS: &str = "maxResponseChars";

/// Where one detector knob sits in the configuration document: `loopDetection.windowWords`.
///
/// The defect it names carries no agent, and that is deliberate: a resolver is handed one
/// declaration and cannot see whose profile it came off. The
/// [launch pass](crate::validate::LaunchReport::for_agent) stamps the profile on the way out.
fn knob_locus(knob: &str) -> String {
    format!("loopDetection.{knob}")
}

/// **Read one knob, and report it if an armed detector owes it.**
///
/// `Some(value)` is the knob exactly as the profile wrote it. `None` says the profile wrote nothing
/// there — reported when `armed`, because an armed detector writes all five, and silent when it is
/// not, because an unarmed declaration owes none of them. Either way the caller's answer is that it
/// has no figure, which is what makes the [placeholder](NO_DETECTOR_ON_A_REFUSED_LAUNCH) the only
/// detector a short declaration can produce.
///
/// `configures` says what the knob does, reading as the object of "which is", so a refusal names
/// *which* term of the rule is missing rather than only that one is.
fn read_knob(
    declared: Option<u64>,
    armed: bool,
    knob: &str,
    configures: &str,
    report: &mut crate::validate::LaunchReport,
) -> Option<u64> {
    match declared {
        Some(value) => Some(value),
        None => {
            if armed {
                report.report(crate::validate::LaunchDefect::run_level(
                    knob_locus(knob),
                    "",
                    format!(
                        "the detector is armed and this profile writes no {knob}, which is \
                         {configures}. What the rule trips on is its five terms together, so gg \
                         substitutes no figure for one nobody wrote: an armed detector states all \
                         five."
                    ),
                ));
            }
            None
        }
    }
}

/// [`read_knob`] for the three whose zero cannot bound anything: zero is **refused**, naming the knob and
/// what a zero would have meant.
///
/// One helper rather than three `match`es so the three refusals are worded the same way and a fourth
/// knob of the same shape cannot be added with a differently shaped sentence.
fn positive_knob(
    declared: Option<u64>,
    armed: bool,
    knob: &str,
    configures: &str,
    consequence: &str,
    report: &mut crate::validate::LaunchReport,
) -> Option<u64> {
    match read_knob(declared, armed, knob, configures, report)? {
        0 => {
            report.report(crate::validate::LaunchDefect::run_level(
                knob_locus(knob),
                "0",
                format!(
                    "{knob} cannot bound anything at zero ({consequence}), and gg will not run a \
                     detector on a figure of its own under the name of the one this profile \
                     configured."
                ),
            ));
            None
        }
        value => Some(value),
    }
}

/// Narrow a declared knob to this platform's `usize`, refusing one it cannot hold.
///
/// On every host gg runs on a `usize` is 64 bits wide and this can never fire; it is written as a
/// refusal rather than a saturation for the reason
/// [`resolve_run_limits`](crate::limits::resolve_run_limits) narrows its counts that way — an armed
/// detector must be the one the profile wrote, not the widest one the platform happened to hold.
/// So it answers `None`, exactly as a knob nobody wrote does, and the detector that results is the
/// [placeholder](NO_DETECTOR_ON_A_REFUSED_LAUNCH).
fn as_usize(value: u64, knob: &str, report: &mut crate::validate::LaunchReport) -> Option<usize> {
    match usize::try_from(value) {
        Ok(value) => Some(value),
        Err(_) => {
            report.report(unholdable(knob, value, "this host"));
            None
        }
    }
}

/// Narrow a declared knob to a `u32`, refusing one it cannot hold, for the reason [`as_usize`] does.
fn as_u32(value: u64, knob: &str, report: &mut crate::validate::LaunchReport) -> Option<u32> {
    match u32::try_from(value) {
        Ok(value) => Some(value),
        Err(_) => {
            report.report(unholdable(knob, value, "gg's 32-bit occurrence counter"));
            None
        }
    }
}

/// A knob whose value is past what gg counts it in.
fn unholdable(knob: &str, value: u64, holder: &str) -> crate::validate::LaunchDefect {
    crate::validate::LaunchDefect::run_level(
        knob_locus(knob),
        value.to_string(),
        format!(
            "{holder} cannot hold a {knob} of {value}, and arming the largest one it can hold would \
             be a detector nobody configured."
        ),
    )
}

#[cfg(test)]
#[path = "loopguard.test.rs"]
mod tests;
