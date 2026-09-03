//! Tests for the `[audio]` table: the one key every test type declares its audio
//! palette in (`packs`), the arity each `asset_kind` allows, the format fields only
//! an asset-generation case may state, and the pinned default the full-stack
//! versions that predate the key fall back to.
//!
//! Split out of `test_case.test.rs` — which keeps the clip-format checks beside the
//! other asset-generation table tests — because these span every test type rather
//! than one arm of resolution, and that file is already long.

use super::tests::{MINIMAL_JAM, asset_catalog, catalog_with_jam, catalog_with_manifest};
use super::*;

/// A full-stack manifest body: the `[build]` table every full-stack case carries,
/// with `tables` appended (an `[audio]` table, or nothing).
fn full_stack_tables(tables: &str) -> String {
    format!(
        "type = \"full-stack\"\n[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n{tables}"
    )
}

/// Resolve a full-stack version declaring `tables`, expecting it to resolve.
fn full_stack(tables: &str) -> TestCaseVersion {
    let (_dir, catalog) = catalog_with_manifest(&full_stack_tables(tables));
    catalog.resolve("demo", "v1.0.0").expect("resolve")
}

/// Resolve a full-stack version declaring `tables`, expecting it to be refused, and
/// return the rendered failure.
fn reject_full_stack(tables: &str) -> String {
    let (_dir, catalog) = catalog_with_manifest(&full_stack_tables(tables));
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("the manifest should be refused");
    format!("{err}")
}

/// An audio asset-generation manifest of `kind` declaring `audio` as its `[audio]`
/// table body.
fn audio_manifest(kind: &str, audio: &str) -> String {
    format!(
        "slug = \"sprite\"\nname = \"Asset\"\ndifficulty = \"medium\"\n\
         tags = [\"asset-generation\"]\nprompt = \"prompt.hbs\"\nchangelog = \"changelog.md\"\n\
         type = \"asset-generation\"\nasset_kind = \"{kind}\"\n\
         variants = [\"variants/base.toml\"]\n\
         [audio]\n{audio}\
         [tool]\nbinary = \"{kind}\"\npreview = \"waveform.png\"\n\
         [output]\nactions = \"actions.json\"\n\
         [[spec]]\nsource = \"specs/brief.md\"\ndest = \"specs/brief.md\"\n\
         [[domain]]\nid = \"fidelity\"\ndescription = \"How close the clip is.\"\n"
    )
}

/// The three format fields every audio asset-generation case states.
const AUDIO_FORMAT: &str = "sample_rate = 44100\nchannels = \"stereo\"\nmax_duration_ms = 5000\n";

/// Resolve an audio asset-generation case of `kind` with the `[audio]` body `audio`,
/// expecting it to resolve.
fn audio_case(kind: &str, audio: &str) -> TestCaseVersion {
    let (_dir, catalog) = asset_catalog(&audio_manifest(kind, audio));
    catalog.resolve("sprite", "v1.0.0").expect("resolve")
}

/// Resolve an audio asset-generation case of `kind` with the `[audio]` body `audio`,
/// expecting it to be refused, and return the rendered failure.
fn reject_audio_case(kind: &str, audio: &str) -> String {
    let (_dir, catalog) = asset_catalog(&audio_manifest(kind, audio));
    let err = catalog
        .resolve("sprite", "v1.0.0")
        .expect_err("the manifest should be refused");
    format!("{err}")
}

// --- the pinned default -----------------------------------------------------

#[test]
fn the_frozen_default_is_the_four_packs_those_versions_were_authored_against() {
    // Asserted as an exact literal, in order, because this constant is the only
    // thing standing between a frozen full-stack version and a palette that changes
    // under it. Growing it, shrinking it, reordering it, or repinning any entry is a
    // deliberate edit that has to fail this assertion first — and adding a fifth
    // entry additionally has to widen the `[&str; 4]` type, so neither half of the
    // change can be made by accident.
    assert_eq!(
        DEFAULT_AUDIO_PACKS,
        [
            "combat-core@0.1.0",
            "gm-lite@0.1.0",
            "cinematic@0.1.0",
            "synthwave@0.1.0",
        ]
    );
    // Every entry pins a version, so publishing a new version of one of these packs
    // does not reach a version that receives the default either.
    for pack_ref in DEFAULT_AUDIO_PACKS {
        let (name, version) = pack_ref.split_once('@').expect("a pinned `name@version`");
        assert!(
            !name.is_empty() && !version.is_empty(),
            "{pack_ref} pins a version"
        );
    }
}

#[test]
fn publishing_a_new_pack_cannot_join_the_frozen_default() {
    // The failure this rules out: publishing a pack used to widen what an already
    // frozen case received, because the run image baked whatever the image's pack
    // list held. Resolution now reads no registry at all — not
    // `containers/sample-packs/`, not the audio store, nothing — so a full-stack
    // version that declares no `[audio]` table receives the pinned literal and only
    // the pinned literal, whatever has been published since.
    let version = full_stack("");
    assert_eq!(version.audio_packs, DEFAULT_AUDIO_PACKS);
    assert_eq!(
        version.audio_packs.len(),
        4,
        "the default is a fixed set of four, not a scan of the published packs"
    );
}

#[test]
fn a_jam_with_no_audio_table_receives_the_same_pinned_default() {
    // A jam runs in the same image a full-stack case does and produces its own sound
    // the same way, so a jam that declares nothing falls back to the same set.
    let (_dir, catalog) = catalog_with_jam(MINIMAL_JAM);
    let version = catalog.resolve("trains", "v1.0.0").expect("resolve jam");
    assert_eq!(version.audio_packs, DEFAULT_AUDIO_PACKS);
}

#[test]
fn a_case_that_produces_no_audio_declares_no_packs() {
    // The default is for the two types that produce their own sound. An end-to-end
    // case (and every other type that may not declare the table) resolves to an
    // empty list, so staging gives its runs no audio tree at all.
    let (_dir, catalog) =
        catalog_with_manifest("[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"");
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(version.test_type, TestType::EndToEnd);
    assert!(version.audio_packs.is_empty());
}

// --- a full-stack case's declaration ----------------------------------------

#[test]
fn a_full_stack_case_declares_the_subset_it_needs() {
    // The point of the key: a case that only wants one sample pack and one bank says
    // so, and its runs are staged with those two and nothing else.
    let version = full_stack("[audio]\npacks = [\"combat-core@0.1.0\", \"gm-lite@0.1.0\"]\n");
    assert_eq!(
        version.audio_packs,
        vec!["combat-core@0.1.0".to_string(), "gm-lite@0.1.0".to_string()]
    );
}

#[test]
fn a_full_stack_declaration_keeps_its_authored_order() {
    // Order is load-bearing downstream: the first entry of each kind is what a tool
    // config naming no pack plays, so resolution must not sort or dedupe the list.
    let version = full_stack(
        "[audio]\npacks = [\"synthwave@0.1.0\", \"combat-core@0.1.0\", \"gm-lite@0.1.0\"]\n",
    );
    assert_eq!(
        version.audio_packs,
        vec![
            "synthwave@0.1.0".to_string(),
            "combat-core@0.1.0".to_string(),
            "gm-lite@0.1.0".to_string(),
        ]
    );
}

#[test]
fn a_full_stack_case_may_declare_no_packs_at_all() {
    // An empty list is a declaration, not an omission: the case says its game makes
    // no sampled sound. It is distinct from carrying no table, which takes the frozen
    // default — that distinction is why the table's presence is read rather than its
    // emptiness inferred.
    let version = full_stack("[audio]\npacks = []\n");
    assert!(version.audio_packs.is_empty());
}

#[test]
fn a_full_stack_case_may_not_state_the_clip_format() {
    // The format fields fix the single clip an asset-generation run emits; a
    // full-stack run emits as many as its game needs, each in whatever format the
    // call asks for, so stating one here would be meaningless.
    let err = reject_full_stack("[audio]\nsample_rate = 44100\npacks = [\"gm-lite@0.1.0\"]\n");
    assert!(
        err.contains(
            "a full-stack case's [audio] table declares only `packs`; sample_rate, \
             channels and max_duration_ms describe an asset-generation case's single clip"
        ),
        "got: {err}"
    );
}

#[test]
fn a_jam_declares_its_packs_the_same_way_and_is_named_as_a_jam() {
    let manifest = format!("{MINIMAL_JAM}[audio]\npacks = [\"combat-core@0.1.0\"]\n");
    let (_dir, catalog) = catalog_with_jam(&manifest);
    let version = catalog.resolve("trains", "v1.0.0").expect("resolve jam");
    assert_eq!(version.audio_packs, vec!["combat-core@0.1.0".to_string()]);

    // The same rejection, worded for the manifest the author is looking at.
    let manifest = format!("{MINIMAL_JAM}[audio]\nchannels = \"mono\"\n");
    let (_dir, catalog) = catalog_with_jam(&manifest);
    let err = format!(
        "{}",
        catalog
            .resolve("trains", "v1.0.0")
            .expect_err("a jam stating a clip format is refused")
    );
    assert!(
        err.contains("a game-jam case's [audio] table declares only `packs`"),
        "got: {err}"
    );
}

// --- where the table is valid at all ----------------------------------------

#[test]
fn a_type_that_produces_no_audio_rejects_the_table() {
    // End-to-end, adversarial, and performance runs produce no audio, so the table is
    // refused outright rather than resolved into a palette nothing would read.
    let (_dir, catalog) = catalog_with_manifest(
        "[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [audio]\npacks = [\"gm-lite@0.1.0\"]\n",
    );
    let err = format!(
        "{}",
        catalog
            .resolve("demo", "v1.0.0")
            .expect_err("an end-to-end case declaring [audio] is refused")
    );
    assert!(
        err.contains(
            "the [audio] table is only valid for an asset-generation, full-stack \
             or game-jam case"
        ),
        "got: {err}"
    );
}

#[test]
fn a_non_audio_asset_kind_still_rejects_the_table() {
    // The asset-generation arms keep their own wording: within asset-generation the
    // table belongs to the three audio kinds and to no other.
    let manifest = "slug = \"sprite\"\nname = \"Asset\"\ndifficulty = \"medium\"\n\
         tags = [\"asset-generation\"]\nprompt = \"prompt.hbs\"\nchangelog = \"changelog.md\"\n\
         type = \"asset-generation\"\nvariants = [\"variants/base.toml\"]\n\
         [canvas]\nwidth = 64\nheight = 64\nbackground = \"transparent\"\n\
         [audio]\npacks = [\"gm-lite@0.1.0\"]\n\
         [tool]\nbinary = \"draw\"\npreview = \"canvas.png\"\n\
         [output]\nactions = \"actions.json\"\n\
         [[spec]]\nsource = \"specs/brief.md\"\ndest = \"specs/brief.md\"\n\
         [[domain]]\nid = \"fidelity\"\ndescription = \"How close.\"\n";
    let (_dir, catalog) = asset_catalog(manifest);
    let err = format!(
        "{}",
        catalog
            .resolve("sprite", "v1.0.0")
            .expect_err("a sprite case declaring [audio] is refused")
    );
    assert!(err.contains("[audio]"), "got: {err}");
}

// --- ref shape --------------------------------------------------------------

#[test]
fn a_pack_ref_must_pin_a_version() {
    // Both halves are required: an unpinned ref would leave the loaded pack's
    // identity uncheckable, which is the only thing standing between a run and a
    // silently substituted palette.
    for bad in ["gm-lite", "gm-lite@", "@0.1.0", ""] {
        let err = reject_full_stack(&format!("[audio]\npacks = [\"{bad}\"]\n"));
        assert!(
            err.contains(&format!(
                "audio.packs[0] `{bad}`: a pack ref must be `name@version`"
            )),
            "got: {err}"
        );
    }
}

#[test]
fn a_malformed_ref_is_reported_by_its_position() {
    let err = reject_full_stack("[audio]\npacks = [\"combat-core@0.1.0\", \"gm-lite\"]\n");
    assert!(
        err.contains("audio.packs[1] `gm-lite`: a pack ref must be `name@version`"),
        "got: {err}"
    );
}

#[test]
fn a_pack_may_not_be_named_twice() {
    // Two versions of one pack cannot both be staged: they share a name, a staged
    // directory slot, and a default slot, so the declaration is ambiguous rather
    // than additive.
    let err = reject_full_stack("[audio]\npacks = [\"gm-lite@0.1.0\", \"gm-lite@0.2.0\"]\n");
    assert!(
        err.contains("audio.packs names `gm-lite` twice; a run carries one version of a pack"),
        "got: {err}"
    );
}

// --- arity, per asset kind --------------------------------------------------

#[test]
fn a_sfx_sample_case_declares_exactly_one_pack() {
    let version = audio_case(
        "sfx-sample",
        &format!("{AUDIO_FORMAT}packs = [\"combat-core@0.1.0\"]\n"),
    );
    assert_eq!(version.audio_packs, vec!["combat-core@0.1.0".to_string()]);

    let err = reject_audio_case("sfx-sample", AUDIO_FORMAT);
    assert!(
        err.contains("a `sfx-sample` case declares exactly one pack in audio.packs, not 0"),
        "got: {err}"
    );

    let err = reject_audio_case(
        "sfx-sample",
        &format!("{AUDIO_FORMAT}packs = [\"combat-core@0.1.0\", \"gm-lite@0.1.0\"]\n"),
    );
    assert!(
        err.contains("a `sfx-sample` case declares exactly one pack in audio.packs, not 2"),
        "got: {err}"
    );
}

#[test]
fn a_music_case_declares_exactly_one_pack() {
    let version = audio_case(
        "music",
        &format!("{AUDIO_FORMAT}packs = [\"gm-lite@0.1.0\"]\n"),
    );
    assert_eq!(version.audio_packs, vec!["gm-lite@0.1.0".to_string()]);

    let err = reject_audio_case("music", AUDIO_FORMAT);
    assert!(
        err.contains("a `music` case declares exactly one pack in audio.packs, not 0"),
        "got: {err}"
    );

    let err = reject_audio_case(
        "music",
        &format!("{AUDIO_FORMAT}packs = [\"gm-lite@0.1.0\", \"cinematic@0.1.0\"]\n"),
    );
    assert!(
        err.contains("a `music` case declares exactly one pack in audio.packs, not 2"),
        "got: {err}"
    );
}

#[test]
fn a_sfx_synth_case_declares_no_packs() {
    // The regression test for the one audio kind that must keep declaring nothing: it
    // builds its sound from oscillators and noise, so a pack would be staged into its
    // container and never read.
    let version = audio_case("sfx-synth", AUDIO_FORMAT);
    assert!(version.audio_packs.is_empty());

    let err = reject_audio_case(
        "sfx-synth",
        &format!("{AUDIO_FORMAT}packs = [\"combat-core@0.1.0\"]\n"),
    );
    assert!(
        err.contains(
            "a `sfx-synth` case declares no audio.packs: it synthesizes from oscillators alone"
        ),
        "got: {err}"
    );
}

// --- the format fields ------------------------------------------------------

#[test]
fn an_audio_case_states_all_three_format_fields() {
    let err = reject_audio_case("sfx-sample", "packs = [\"combat-core@0.1.0\"]\n");
    assert!(
        err.contains(
            "an audio asset-generation case requires audio.sample_rate, audio.channels \
             and audio.max_duration_ms"
        ),
        "got: {err}"
    );
}

#[test]
fn the_format_fields_are_still_checked() {
    let err = reject_audio_case(
        "sfx-synth",
        "sample_rate = 0\nchannels = \"mono\"\nmax_duration_ms = 800\n",
    );
    assert!(
        err.contains("audio.sample_rate must be greater than zero"),
        "got: {err}"
    );

    let err = reject_audio_case(
        "sfx-synth",
        "sample_rate = 44100\nchannels = \"quad\"\nmax_duration_ms = 800\n",
    );
    assert!(
        err.contains("audio.channels `quad` must be `mono` or `stereo`"),
        "got: {err}"
    );

    let err = reject_audio_case(
        "sfx-synth",
        "sample_rate = 44100\nchannels = \"mono\"\nmax_duration_ms = 0\n",
    );
    assert!(
        err.contains("audio.max_duration_ms must be greater than zero"),
        "got: {err}"
    );
}

// --- the keys `packs` replaced ----------------------------------------------

#[test]
fn a_stale_sample_pack_key_is_refused_rather_than_ignored() {
    // `sample_pack` and `instrument_bank` are gone. Silently ignoring one would leave
    // a case pointing at a palette its runs never receive — exactly the class of
    // failure the whole change exists to remove — so the table denies unknown keys
    // and the stale spelling fails at parse.
    let err = reject_audio_case(
        "sfx-sample",
        &format!("{AUDIO_FORMAT}sample_pack = \"combat-core@0.1.0\"\n"),
    );
    assert!(err.contains("sample_pack"), "got: {err}");

    let err = reject_audio_case(
        "music",
        &format!("{AUDIO_FORMAT}instrument_bank = \"gm-lite@0.1.0\"\n"),
    );
    assert!(err.contains("instrument_bank"), "got: {err}");
}
