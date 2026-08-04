//! Tests for [loop detection](super): the streaming detector, the eviction and offender bookkeeping
//! underneath it, and the resolution of an operator's declaration into knobs.
//!
//! Every case here is pure — there is no connection, no model, no clock and no filesystem behind any
//! of them. A [`LoopGuard`] is fed `&str` chunks by hand, exactly as the streaming transport will
//! feed it text deltas, and asked what it would abandon.
//!
//! Two of these tests carry more weight than the rest, and they are the two halves of the same
//! question:
//!
//! - [`a_reply_that_became_a_period_is_abandoned`] is the defect this module exists for, in the
//!   shape it was actually observed in.
//! - [`a_tilemap_literal_saturates_the_window_and_is_still_not_a_loop`] is the false positive that
//!   would make the feature unusable. It is deliberately built the way a model really writes a level
//!   — fifteen hundred entries, a realistic mixture of tile ids, fed in small chunks — because a
//!   token version of it would pass without ever exercising the case it is protecting: that literal
//!   *does* saturate the detector's window, for well over a thousand consecutive words, and is saved
//!   only by the sustained-run term.

use test_cabinet_core::gg::GgLoopDetection;

use super::*;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/// Feed `text` in chunks of `chunk_chars` characters, as a stream would deliver it, and return the
/// first trip it produced.
///
/// Splitting on characters rather than bytes is what a real transport does *not* guarantee, which is
/// exactly why the guard buffers a pending word: chunking here at deliberately awkward widths is the
/// test's way of asserting that where the chunk boundaries fell made no difference.
fn feed(guard: &mut LoopGuard, text: &str, chunk_chars: usize) -> Option<LoopTrip> {
    feed_peak(guard, text, chunk_chars).0
}

/// [`feed`], additionally reporting the highest saturated run observed along the way.
///
/// The peak is what a negative test actually wants to assert: "this reply did not trip" is weak
/// (almost nothing trips), while "this reply held the window saturated for 1400 consecutive words
/// and still did not trip" is the property under test. Sampled once per chunk, so it is a lower
/// bound on the true peak — which is the safe direction for every assertion made against it.
fn feed_peak(guard: &mut LoopGuard, text: &str, chunk_chars: usize) -> (Option<LoopTrip>, usize) {
    let chars: Vec<char> = text.chars().collect();
    let mut peak = 0;
    for piece in chars.chunks(chunk_chars) {
        let chunk: String = piece.iter().collect();
        if let LoopVerdict::Looping(trip) = guard.push(&chunk) {
            return (Some(trip), peak);
        }
        peak = peak.max(guard.saturated_run());
    }
    (None, peak)
}

/// A configuration whose repetition rule can never fire, for isolating the length backstop and the
/// bookkeeping tests: no window can ever hold `usize::MAX` distinct offenders.
fn repetition_off() -> LoopGuardConfig {
    LoopGuardConfig {
        min_offenders: usize::MAX,
        ..LoopGuardConfig::default()
    }
}

/// An armed declaration with every knob left to gg's defaults — the base every resolution case
/// varies one field of.
fn armed_declaration() -> GgLoopDetection {
    GgLoopDetection {
        enabled: true,
        ..GgLoopDetection::default()
    }
}

/// The knobs `declared` resolves to, together with every warning the resolution produced.
fn resolve(declared: GgLoopDetection) -> (LoopGuardConfig, Vec<String>) {
    let resolved = resolve_loop_guard(&declared);
    (
        resolved
            .config
            .expect("an armed declaration resolves to a detector"),
        resolved.warnings,
    )
}

/// The knobs `declared` resolves to, asserting it produced no warning at all.
fn resolve_cleanly(declared: GgLoopDetection) -> LoopGuardConfig {
    let (config, warnings) = resolve(declared);
    assert!(warnings.is_empty(), "unexpected warnings: {warnings:?}");
    config
}

/// The single warning `declared` produced, asserting there was exactly one.
fn sole_warning(declared: GgLoopDetection) -> String {
    let (_, mut warnings) = resolve(declared);
    assert_eq!(warnings.len(), 1, "expected one warning, got {warnings:?}");
    warnings.remove(0)
}

/// A tilemap literal of the shape a model actually writes for a 2D game: a `const` array of
/// `rows × cols` tile ids, one row of the level per source line, with a plausible mixture — roughly
/// 55% floor, 30% wall, 10% decoration, 5% spawn.
///
/// The mixture is the point. A map that were 95% zeroes would put a *single* word over the
/// frequency threshold, and a single offender is not saturation; a real level has two ids that are
/// both common, which is exactly the shape that saturates the window and would trip a detector
/// without the sustained-run term. Generated from a fixed LCG so the corpus is identical on every
/// run and the numbers this test asserts cannot drift.
fn tilemap_source(rows: usize, cols: usize) -> String {
    let mut out = String::from("const LEVEL_TILES = [\n");
    let total = rows * cols;
    let mut seed: u64 = 0x5eed_1337;
    for index in 0..total {
        if index % cols == 0 {
            out.push_str("  ");
        }
        seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let tile = match (seed >> 33) % 20 {
            0..=10 => 0,
            11..=16 => 1,
            17..=18 => 2,
            _ => 3,
        };
        out.push_str(&tile.to_string());
        if index + 1 < total {
            out.push(',');
        }
        if (index + 1) % cols == 0 {
            out.push('\n');
        } else {
            out.push(' ');
        }
    }
    out.push_str("];\n");
    out
}

/// An ordinary module of the kind a model writes between its data literals — no pathological
/// repetition, but the perfectly normal recurrence of `const`, braces and property accesses that a
/// naive detector would have to survive.
const ORDINARY_JS: &str = r#"
const TILE_SIZE = 16;
const FRICTION = 0.86;
const GRAVITY = 0.42;

export function createWorld(map, spawn) {
  const world = {
    map,
    entities: [],
    camera: { x: spawn.x, y: spawn.y, zoom: 2 },
    elapsed: 0,
    paused: false,
  };
  world.player = spawnPlayer(world, spawn);
  return world;
}

function spawnPlayer(world, at) {
  const player = {
    kind: "player",
    x: at.x * TILE_SIZE,
    y: at.y * TILE_SIZE,
    vx: 0,
    vy: 0,
    grounded: false,
    health: 6,
  };
  world.entities.push(player);
  return player;
}

export function step(world, dt, input) {
  if (world.paused) {
    return;
  }
  world.elapsed += dt;
  const player = world.player;
  player.vx += input.axis * 0.6;
  player.vx *= FRICTION;
  player.vy += GRAVITY;
  if (input.jump && player.grounded) {
    player.vy = -7.4;
    player.grounded = false;
  }
  moveAndCollide(world, player, dt);
  followCamera(world.camera, player, dt);
}

function moveAndCollide(world, body, dt) {
  body.x += body.vx * dt;
  resolveHorizontal(world.map, body);
  body.y += body.vy * dt;
  body.grounded = resolveVertical(world.map, body);
}

function followCamera(camera, target, dt) {
  const lerp = Math.min(1, dt * 4);
  camera.x += (target.x - camera.x) * lerp;
  camera.y += (target.y - camera.y) * lerp;
}
"#;

/// A passage of ordinary technical prose — the other thing a reply is full of, and the baseline the
/// frequency rule must leave completely alone.
const ORDINARY_PROSE: &str = "
The renderer draws the level in two passes. The first pass walks the tile grid and emits one quad
per visible cell, skipping every empty tile, which keeps the vertex buffer proportional to what the
camera can actually see rather than to the size of the level. The second pass draws the entities in
depth order, back to front, so a character standing behind a pillar is occluded by it without any
depth buffer being involved at all.

Sorting happens once per frame, on a scratch array that is reused between frames, because the
allocation showed up clearly in a profile of the first prototype. The comparison is on the entity's
foot position rather than its origin, which is what makes a tall sprite overlap correctly with a
short one standing beside it. Ties are broken by insertion order so that the sort is stable and a
pair of entities standing on exactly the same row does not flicker between frames.

Input is sampled at the top of the frame and held for its duration. Holding it is what lets the
simulation run at a fixed step while the renderer runs as fast as the display allows: the fixed
step consumes the sampled input as many times as it needs to catch up, and the interpolation
between the last two simulated states is what the renderer actually draws. Without that, a slow
frame would show the player teleporting, and a fast one would show it stuttering.

Audio is deliberately not part of the simulation. Cues are queued as the simulation runs and played
once, after it, so that a step which is replayed during catch-up cannot play the same footfall
twice. The queue is cleared every frame whether or not anything consumed it, because a cue that
survived into a later frame would be heard at the wrong moment.
";

// ---------------------------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------------------------

/// The observed defect, in the shape it was observed in: a model that stopped replying and started
/// emitting `void 0;` forever.
///
/// The arithmetic is asserted exactly rather than approximately, because every figure in it is a
/// consequence of the algorithm and a change to any of them is a change to the detector:
///
/// - the reply is two alternating words, so `void` passes 32 occurrences at word 65 and `0;` at
///   word 66 — the window is saturated from word 66;
/// - the sustained run therefore reaches 3000 at word 3065, and the window has long since filled;
/// - so the trip lands 3065 words in, which is inside one window of the `N + R` a reply that only
///   became repetitive at its very first word would have taken.
#[test]
fn a_reply_that_became_a_period_is_abandoned() {
    let mut guard = LoopGuard::new(LoopGuardConfig::default());

    let mut trip = None;
    let mut lines = 0;
    for _ in 0..5_000 {
        lines += 1;
        if let LoopVerdict::Looping(caught) = guard.push("void 0;\n") {
            trip = Some(caught);
            break;
        }
    }

    assert_eq!(
        trip,
        Some(LoopTrip::Repetition {
            offenders: 2,
            saturated_run: DEFAULT_MIN_SATURATED_RUN,
            words: 3065,
        }),
    );
    assert_eq!(lines, 1533, "the trip lands mid-line, on `void` #1533");

    let expected = (DEFAULT_WINDOW_WORDS + DEFAULT_MIN_SATURATED_RUN) as u64;
    assert!(
        (expected - 3065) < DEFAULT_WINDOW_WORDS as u64,
        "the trip should land within one window of N + R",
    );
    // And nowhere near the length backstop: the repetition rule is what caught this, at 5% of the
    // characters the backstop would have allowed.
    assert_eq!(guard.chars_seen(), 12_261);
    assert!(guard.chars_seen() < DEFAULT_MAX_RESPONSE_CHARS);
}

/// The false positive that would make the feature unusable, built the way a model really writes a
/// level.
///
/// This literal **does** saturate the detector's window — two tile ids are each far over the
/// frequency threshold for the whole of it — and it stays saturated for well over a thousand
/// consecutive words. Everything except the sustained-run term says it is a loop. It is not, and
/// what tells the two apart is that it *ends*: the assertions below are that the peak run climbed
/// high (so this test really is exercising the dangerous path rather than passing vacuously), that
/// nothing tripped, and that ordinary code after the literal pulls the window back out of
/// saturation entirely.
///
/// For scale: this fixture peaks at a saturated run of **1409** words against a default ceiling of
/// 3000 — so a level roughly twice this size would still be read as the data it is, and one very
/// much larger than that would not. That is the margin the defaults actually buy, stated here
/// because it is the number a future adjustment to either figure has to be weighed against.
#[test]
fn a_tilemap_literal_saturates_the_window_and_is_still_not_a_loop() {
    let tilemap = tilemap_source(47, 32);
    assert_eq!(
        tilemap.matches(',').count(),
        1_503,
        "the fixture is a realistic 1504-entry level",
    );

    let mut guard = LoopGuard::new(LoopGuardConfig::default());
    // Seven characters at a time: a tile entry is three, so words straddle chunk boundaries
    // constantly, which is what a real stream does.
    let (trip, peak) = feed_peak(&mut guard, &tilemap, 7);

    assert_eq!(trip, None, "a level is not a loop");
    assert!(
        peak > 800,
        "the literal should hold the window saturated for a long run (peak was {peak}), or this \
         test is not exercising the case it exists for",
    );
    assert!(
        peak < DEFAULT_MIN_SATURATED_RUN,
        "and the run must stay under the ceiling (peak was {peak})",
    );
    assert!(
        guard.offenders() >= DEFAULT_MIN_OFFENDERS,
        "the window is saturated at the end of the literal",
    );

    // The rest of the file pushes the tiles out of the window, and the saturation goes with them.
    let (trip, _) = feed_peak(&mut guard, ORDINARY_JS, 7);
    assert_eq!(trip, None);
    assert_eq!(
        guard.saturated_run(),
        0,
        "ordinary code after the literal clears the saturation",
    );
    assert!(guard.offenders() < DEFAULT_MIN_OFFENDERS);
}

/// Ordinary prose does not merely fail to trip — it never comes close to saturating the window,
/// which is the stronger property and the one that says the frequency threshold is set sensibly.
#[test]
fn ordinary_prose_never_even_saturates_the_window() {
    let mut guard = LoopGuard::new(LoopGuardConfig::default());
    let (trip, peak) = feed_peak(&mut guard, ORDINARY_PROSE, 11);

    assert_eq!(trip, None);
    assert_eq!(peak, 0, "prose should never saturate the window at all");
    assert!(guard.offenders() < DEFAULT_MIN_OFFENDERS);
    assert!(
        guard.words_seen() > DEFAULT_WINDOW_WORDS as u64,
        "the passage must be long enough to have filled the window",
    );
}

/// Ordinary source does not trip either, despite the perfectly normal recurrence of `const`, braces
/// and property accesses that a naive frequency rule would have to be tuned around.
#[test]
fn ordinary_javascript_source_does_not_trip() {
    let mut guard = LoopGuard::new(LoopGuardConfig::default());
    let (trip, peak) = feed_peak(&mut guard, ORDINARY_JS, 13);

    assert_eq!(trip, None);
    assert!(
        peak < DEFAULT_MIN_SATURATED_RUN,
        "source code holds no sustained saturation (peak was {peak})",
    );
}

// ---------------------------------------------------------------------------------------------
// Word extraction
// ---------------------------------------------------------------------------------------------

/// Indentation, blank lines and the whitespace between tokens contribute characters and nothing
/// else. A detector that counted them would find every indented file repetitive.
#[test]
fn indentation_and_blank_lines_never_contribute_a_word() {
    let mut guard = LoopGuard::new(LoopGuardConfig::default());

    assert_eq!(guard.push("        \n\t\n   \n"), LoopVerdict::Continue);
    assert_eq!(guard.words_seen(), 0);
    assert_eq!(guard.chars_seen(), 15);

    guard.push("    const x = 1;\n");
    assert_eq!(guard.words_seen(), 4, "const, x, =, 1;");
    assert_eq!(guard.count_of("const"), 1);
}

/// An identifier delivered across three stream chunks is one word, not three.
///
/// This is the whole reason a pending run is buffered rather than each chunk being tokenised on its
/// own: a transport that split words would manufacture novel fragments out of ordinary code and
/// make the frequency rule meaningless.
#[test]
fn an_identifier_split_across_three_chunks_is_one_word() {
    let mut guard = LoopGuard::new(LoopGuardConfig::default());

    guard.push("cons");
    guard.push("tructTile");
    guard.push("Map ");

    assert_eq!(guard.words_seen(), 1);
    assert_eq!(guard.count_of("constructTileMap"), 1);
    assert_eq!(guard.count_of("cons"), 0);
}

/// A reply's final partial word is never counted, because nothing terminated it — and that costs
/// nothing, since a reply that ends is not looping.
#[test]
fn a_trailing_partial_word_is_never_counted() {
    let mut guard = LoopGuard::new(LoopGuardConfig::default());

    guard.push("one two thr");

    assert_eq!(guard.words_seen(), 2);
    assert_eq!(guard.count_of("thr"), 0);
}

/// A whitespace-free periodic loop is caught through the [`MAX_WORD_CHARS`] path: the run is cut
/// into fixed-width slices, and a period that does not divide the cap yields a small set of slices
/// that recur — three of them here, for a six-character period cut at 128.
///
/// Without the cap the entire reply would be one unbounded word occurring exactly once, and both
/// the memory bound and the detection would be lost.
#[test]
fn a_whitespace_free_periodic_loop_is_caught_by_the_word_cap() {
    let config = LoopGuardConfig {
        window_words: 16,
        repeat_threshold: 4,
        min_offenders: 2,
        min_saturated_run: 8,
        max_response_chars: 0,
    };
    let mut guard = LoopGuard::new(config);

    // `void0;` is six characters; 128 mod 6 is 2, so successive slices cycle through three distinct
    // phases and each recurs every third word.
    let trip = feed(&mut guard, &"void0;".repeat(600), 5);

    assert_eq!(
        trip,
        Some(LoopTrip::Repetition {
            offenders: 3,
            saturated_run: 8,
            words: 21,
        }),
    );
    assert_eq!(
        guard.words_seen(),
        21,
        "every word here is a cap-flushed slice; not one of them was terminated by whitespace",
    );
}

/// Text in another alphabet is cut on character boundaries, never byte ones, so a multi-byte run
/// longer than the cap neither panics nor produces invalid slices.
#[test]
fn a_reply_written_in_another_alphabet_does_not_panic() {
    let mut guard = LoopGuard::new(LoopGuardConfig::default());

    // 600 characters with no whitespace anywhere: four cap-flushed words and an 88-character
    // remainder that is never counted.
    let verdict = guard.push(&"日本語".repeat(200));

    assert_eq!(verdict, LoopVerdict::Continue);
    assert_eq!(guard.words_seen(), 4);
    assert_eq!(guard.chars_seen(), 600, "characters, not bytes");

    // The leading space terminates that 88-character remainder, so it lands as a fifth word, and
    // the eight words after it bring the total to thirteen.
    guard.push(" ünïcödé wörds — and an emoji 🧱 too\n");
    assert_eq!(guard.words_seen(), 13);
}

/// An empty chunk and a chunk of pure whitespace are no-ops: neither can complete a word that was
/// not already complete, and the empty one contributes not even a character.
#[test]
fn an_empty_chunk_and_a_whitespace_only_chunk_are_no_ops() {
    let mut guard = LoopGuard::new(LoopGuardConfig::default());

    assert_eq!(guard.push(""), LoopVerdict::Continue);
    assert_eq!(guard.words_seen(), 0);
    assert_eq!(guard.chars_seen(), 0);

    assert_eq!(guard.push("   "), LoopVerdict::Continue);
    assert_eq!(guard.words_seen(), 0);
    assert_eq!(guard.chars_seen(), 3);

    guard.push("word");
    assert_eq!(guard.push(""), LoopVerdict::Continue);
    assert_eq!(guard.words_seen(), 0, "the pending word is still pending");
}

// ---------------------------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------------------------

/// Eviction is exact: after `N + k` words the window and its count map hold the last `N` words and
/// nothing else.
#[test]
fn the_window_holds_exactly_the_last_n_words() {
    let mut guard = LoopGuard::new(LoopGuardConfig {
        window_words: 4,
        ..repetition_off()
    });

    feed(&mut guard, "w0 w1 w2 w3 w4 w5 w6 w7 w8 w9 ", 6);

    assert_eq!(guard.words_seen(), 10);
    assert_eq!(guard.window_len(), 4);
    assert_eq!(
        guard.tracked_words(),
        4,
        "the map never outgrows the window"
    );
    for word in ["w6", "w7", "w8", "w9"] {
        assert_eq!(guard.count_of(word), 1, "{word} is in the window");
    }
    for word in ["w0", "w5"] {
        assert_eq!(guard.count_of(word), 0, "{word} was evicted");
    }
}

/// An evicted word gives its count back, and an entry that reaches zero leaves the map — which is
/// what bounds the map's size by the window's rather than by the reply's vocabulary.
#[test]
fn an_evicted_word_gives_its_count_back() {
    let mut guard = LoopGuard::new(LoopGuardConfig {
        window_words: 3,
        ..repetition_off()
    });

    feed(&mut guard, "a a a b ", 4);
    assert_eq!(guard.count_of("a"), 2, "the oldest `a` was evicted by `b`");
    assert_eq!(guard.count_of("b"), 1);
    assert_eq!(guard.tracked_words(), 2);

    feed(&mut guard, "c d ", 4);
    assert_eq!(
        guard.count_of("a"),
        0,
        "the entry is gone, not left at zero"
    );
    assert_eq!(guard.tracked_words(), 3);
}

/// The offender count is maintained incrementally in **both** directions: a word crossing the
/// threshold makes one, and the same word falling back below it as the window moves on unmakes it.
///
/// The decrement is the half a detector is likely to get wrong, and getting it wrong is not a
/// missed trip but a false one — a guard whose offender count only ever climbs will eventually
/// abandon every long reply.
#[test]
fn an_offender_stops_being_one_when_it_falls_out_of_the_window() {
    let mut guard = LoopGuard::new(LoopGuardConfig {
        window_words: 4,
        repeat_threshold: 1,
        min_offenders: 2,
        // High enough that this test observes saturation without ever tripping on it.
        min_saturated_run: 1_000,
        max_response_chars: 0,
    });

    feed(&mut guard, "a b a b ", 3);
    assert_eq!(
        guard.offenders(),
        2,
        "both words occur twice in a window of 4"
    );
    assert_eq!(
        guard.saturated_run(),
        1,
        "the fourth word is the first to arrive with two offenders present",
    );

    feed(&mut guard, "c d e f ", 3);
    assert_eq!(guard.offenders(), 0, "both fell back out of the window");
    assert_eq!(guard.saturated_run(), 0, "and the run broke with them");
}

/// A window that has not yet observed `N` words cannot trip, however saturated it looks: a rule
/// about the last `N` words must not be answered by fewer.
#[test]
fn a_window_that_is_not_full_cannot_trip() {
    let mut guard = LoopGuard::new(LoopGuardConfig {
        window_words: 64,
        repeat_threshold: 1,
        min_offenders: 2,
        min_saturated_run: 0,
        max_response_chars: 0,
    });

    // Two words, each three times over: saturated from the fifth word, but only six words deep.
    assert_eq!(feed(&mut guard, "a b a b a b ", 4), None);
    assert!(guard.offenders() >= 2, "saturated, and still not tripping");
    assert_eq!(guard.window_len(), 6);
}

// ---------------------------------------------------------------------------------------------
// The trip conditions
// ---------------------------------------------------------------------------------------------

/// `min_saturated_run: 0` is the plain frequency rule: the reply is abandoned on the first word at
/// which the window is both full and saturated, with no requirement that the saturation persist.
///
/// The trip below lands on word 8 — the word that fills the window — even though saturation began
/// two words earlier, which is exactly what "as soon as" means here.
#[test]
fn a_saturated_run_of_zero_is_the_plain_frequency_rule() {
    let plain = LoopGuardConfig {
        window_words: 8,
        repeat_threshold: 2,
        min_offenders: 2,
        min_saturated_run: 0,
        max_response_chars: 0,
    };
    let mut guard = LoopGuard::new(plain);

    assert_eq!(
        feed(&mut guard, &"a b ".repeat(50), 3),
        Some(LoopTrip::Repetition {
            offenders: 2,
            saturated_run: 3,
            words: 8,
        }),
    );

    // The same reply, under the same rule plus a sustained-run requirement, survives the whole
    // fifty repetitions — the one term is the whole difference.
    let mut patient = LoopGuard::new(LoopGuardConfig {
        min_saturated_run: 1_000,
        ..plain
    });
    assert_eq!(feed(&mut patient, &"a b ".repeat(50), 3), None);
}

/// The length backstop abandons a reply that is merely enormous, with no repetition rule involved
/// at all — the runaway that generates novel garbage rather than a period.
#[test]
fn the_length_backstop_abandons_a_reply_that_is_merely_enormous() {
    let mut guard = LoopGuard::new(LoopGuardConfig {
        max_response_chars: 100,
        ..repetition_off()
    });

    let trip = feed(&mut guard, &"lorem ipsum dolor sit amet ".repeat(20), 30);

    assert_eq!(
        trip,
        Some(LoopTrip::Length { chars: 120 }),
        "the backstop is checked once per chunk, so it fires on the first chunk to pass it",
    );
}

/// A backstop of zero is off, and the detector is left with the repetition rule alone.
#[test]
fn a_length_backstop_of_zero_is_off() {
    let mut guard = LoopGuard::new(LoopGuardConfig {
        max_response_chars: 0,
        ..repetition_off()
    });

    assert_eq!(
        feed(&mut guard, &"lorem ipsum dolor ".repeat(5_000), 64),
        None
    );
    assert_eq!(guard.chars_seen(), 90_000);
}

/// A guard that has tripped is inert: it keeps answering with the same trip, counts nothing further,
/// and cannot be made to produce a second verdict.
///
/// The caller drops the response and breaks out of its read loop, but it may well have a chunk in
/// hand already — a stable answer is what stops that from being a second, differently-worded
/// failure.
#[test]
fn a_tripped_guard_is_inert() {
    let mut guard = LoopGuard::new(LoopGuardConfig {
        window_words: 8,
        repeat_threshold: 2,
        min_offenders: 2,
        min_saturated_run: 0,
        max_response_chars: 0,
    });

    let trip = feed(&mut guard, &"a b ".repeat(50), 3).expect("tripped");
    let words = guard.words_seen();
    let chars = guard.chars_seen();

    let long = "g ".repeat(100);
    for chunk in ["c d e f ", "", "   ", long.as_str()] {
        assert_eq!(guard.push(chunk), LoopVerdict::Looping(trip));
    }
    assert_eq!(guard.words_seen(), words, "a tripped guard counts nothing");
    assert_eq!(guard.chars_seen(), chars);
}

/// Both trips describe themselves in one sentence, which is the sentence that reaches the operator's
/// log and the error a reply that looped on every attempt ends as.
#[test]
fn a_trip_describes_itself_for_the_operators_log() {
    let repetition = LoopTrip::Repetition {
        offenders: 2,
        saturated_run: 3_000,
        words: 3_065,
    };
    assert_eq!(
        repetition.to_string(),
        "2 words repeated across 3000 consecutive words, 3065 words into the reply",
    );

    assert_eq!(
        LoopTrip::Length { chars: 250_001 }.to_string(),
        "the reply passed 250001 characters without finishing",
    );
}

// ---------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------

/// The default declaration arms nothing, which is what keeps every agent that says nothing on the
/// non-streaming transport.
#[test]
fn an_unarmed_declaration_resolves_to_no_detector_at_all() {
    let resolved = resolve_loop_guard(&GgLoopDetection::default());

    assert_eq!(resolved.config, None);
    assert!(resolved.warnings.is_empty());
}

/// Arming the detector without naming a knob takes gg's defaults, silently.
#[test]
fn an_armed_declaration_with_no_knobs_takes_ggs_defaults() {
    assert_eq!(
        resolve_cleanly(armed_declaration()),
        LoopGuardConfig::default(),
    );
}

/// Every knob is taken exactly as declared when it can do its job.
#[test]
fn every_knob_is_taken_as_declared() {
    let config = resolve_cleanly(GgLoopDetection {
        enabled: true,
        window_words: Some(64),
        repeat_threshold: Some(8),
        min_offenders: Some(3),
        min_saturated_run: Some(500),
        max_response_chars: Some(1_000),
    });

    assert_eq!(
        config,
        LoopGuardConfig {
            window_words: 64,
            repeat_threshold: 8,
            min_offenders: 3,
            min_saturated_run: 500,
            max_response_chars: 1_000,
        },
    );
}

/// A window of no words has nothing to look back over, so it warns and takes the default rather
/// than arming a detector that cannot observe anything.
#[test]
fn a_window_of_no_words_warns_and_takes_the_default() {
    let declared = GgLoopDetection {
        window_words: Some(0),
        ..armed_declaration()
    };

    assert!(sole_warning(declared).contains("windowWords: 0"));
    assert_eq!(resolve(declared).0.window_words, DEFAULT_WINDOW_WORDS);
}

/// A threshold of zero would make every word an offender, so no reply could be told apart from a
/// loop. It warns and takes the default.
#[test]
fn a_threshold_of_zero_warns_and_takes_the_default() {
    let declared = GgLoopDetection {
        repeat_threshold: Some(0),
        ..armed_declaration()
    };

    assert!(sole_warning(declared).contains("repeatThreshold: 0"));
    assert_eq!(
        resolve(declared).0.repeat_threshold,
        DEFAULT_REPEAT_THRESHOLD
    );
}

/// Requiring no offenders would make an empty window count as saturated. It warns and takes the
/// default.
#[test]
fn requiring_no_offenders_warns_and_takes_the_default() {
    let declared = GgLoopDetection {
        min_offenders: Some(0),
        ..armed_declaration()
    };

    assert!(sole_warning(declared).contains("minOffenders: 0"));
    assert_eq!(resolve(declared).0.min_offenders, DEFAULT_MIN_OFFENDERS);
}

/// Demanding more offenders than the window can hold is a mistake in the *relationship* between two
/// knobs, so it is reported with both figures and armed as declared — replacing one of them would
/// hide the mistake instead of reporting it.
#[test]
fn demanding_more_offenders_than_the_window_holds_warns_but_arms() {
    let declared = GgLoopDetection {
        window_words: Some(64),
        min_offenders: Some(300),
        ..armed_declaration()
    };

    let warning = sole_warning(declared);
    assert!(warning.contains("minOffenders (300)"), "{warning}");
    assert!(warning.contains("windowWords (64)"), "{warning}");

    let config = resolve(declared).0;
    assert_eq!(config.min_offenders, 300, "armed exactly as declared");
    assert_eq!(config.window_words, 64);
}

/// The two zeroes that mean something are taken as written and warned about by nothing: a
/// saturated-run of zero is the plain frequency rule, and a length backstop of zero is off.
#[test]
fn the_two_zeroes_that_mean_something_are_taken_as_written() {
    let config = resolve_cleanly(GgLoopDetection {
        min_saturated_run: Some(0),
        max_response_chars: Some(0),
        ..armed_declaration()
    });

    assert_eq!(config.min_saturated_run, 0);
    assert_eq!(config.max_response_chars, 0);
}

/// Knobs declared on an agent that never arms the detector are never warned about: nothing is going
/// to read them, and a warning about a value that will never be used is noise in the one log an
/// operator reads to find out what a run was configured to do.
#[test]
fn knobs_declared_on_an_unarmed_agent_are_never_warned_about() {
    let resolved = resolve_loop_guard(&GgLoopDetection {
        enabled: false,
        window_words: Some(0),
        min_offenders: Some(0),
        repeat_threshold: Some(0),
        ..GgLoopDetection::default()
    });

    assert_eq!(resolved.config, None);
    assert!(resolved.warnings.is_empty());
}

/// A knob wider than this platform's `usize` saturates rather than wrapping: the operator's intent
/// ("effectively never") is kept, where wrapping would silently arm a tiny ceiling.
#[test]
fn a_knob_wider_than_the_platform_saturates() {
    let config = resolve_cleanly(GgLoopDetection {
        window_words: Some(u64::MAX),
        repeat_threshold: Some(u64::MAX),
        max_response_chars: Some(u64::MAX),
        ..armed_declaration()
    });

    assert_eq!(config.window_words, usize::MAX);
    assert_eq!(config.repeat_threshold, u32::MAX);
    assert_eq!(config.max_response_chars, usize::MAX);
}

// ---------------------------------------------------------------------------------------------
// The launch line
// ---------------------------------------------------------------------------------------------

/// The launch line names every knob in force, because loop detection changes an agent's transport
/// as well as its policy and neither should have to be inferred from silence.
#[test]
fn the_launch_line_names_every_knob_in_force() {
    let summary = LoopGuardConfig::default().armed_summary();

    assert_eq!(
        summary,
        "loop detection: armed — a reply is abandoned after 3000 consecutive words during which 2 \
         or more words have each occurred more than 32 times in the last 256, or once it passes \
         250000 characters",
    );
}

/// The line says so when the length backstop is off, rather than printing a ceiling of zero.
#[test]
fn the_launch_line_says_when_the_length_backstop_is_off() {
    let summary = LoopGuardConfig {
        max_response_chars: 0,
        ..LoopGuardConfig::default()
    }
    .armed_summary();

    assert!(
        summary.ends_with("there is no length backstop"),
        "{summary}"
    );
}

/// And it says so when saturation alone trips, because that configuration behaves differently
/// enough from the default to be worth reading in a log.
#[test]
fn the_launch_line_says_when_saturation_alone_trips() {
    let summary = LoopGuardConfig {
        min_saturated_run: 0,
        ..LoopGuardConfig::default()
    }
    .armed_summary();

    assert!(summary.contains("as soon as 2 or more words"), "{summary}");
    assert!(!summary.contains("consecutive words"), "{summary}");
}
