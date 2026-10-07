use super::*;

use std::path::Path;

/// A `packs.json` in the shape core writes at container start.
fn staged(defaults: &[(PackKind, &str)], packs: &[(&str, &str, PackKind)]) -> StagedPacks {
    StagedPacks {
        contract: CONTRACT_VERSION,
        defaults: defaults
            .iter()
            .map(|(kind, reference)| (*kind, (*reference).to_string()))
            .collect(),
        packs: packs
            .iter()
            .map(|(name, version, kind)| StagedPack {
                name: (*name).to_string(),
                version: (*version).to_string(),
                kind: *kind,
                dir: pack_dir(name, version),
            })
            .collect(),
    }
}

/// The two-pack palette a full-stack run declaring `combat-core` and `gm-lite` gets.
fn full_stack() -> StagedPacks {
    staged(
        &[
            (PackKind::SamplePack, "combat-core@0.1.0"),
            (PackKind::InstrumentBank, "gm-lite@0.1.0"),
        ],
        &[
            ("combat-core", "0.1.0", PackKind::SamplePack),
            ("gm-lite", "0.1.0", PackKind::InstrumentBank),
        ],
    )
}

/// A store-shaped pack directory: `packs/<name>@<version>/pack.toml`.
fn write_store_pack(root: &Path, name: &str, version: &str, kind: &str) {
    let dir = root.join(pack_dir(name, version));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("pack.toml"),
        format!("name = \"{name}\"\nversion = \"{version}\"\nkind = \"{kind}\"\n"),
    )
    .unwrap();
}

#[test]
fn a_config_naming_no_pack_takes_the_staged_default() {
    let staged = full_stack();
    let pack = staged
        .select(PackKind::SamplePack, None)
        .expect("the default resolves")
        .expect("a sample pack is staged");
    assert_eq!(pack.name, "combat-core");
    assert_eq!(pack.dir, "packs/combat-core@0.1.0");

    let bank = staged
        .select(PackKind::InstrumentBank, None)
        .expect("the default resolves")
        .expect("an instrument bank is staged");
    assert_eq!(bank.name, "gm-lite");
}

#[test]
fn a_config_naming_a_declared_pack_selects_it() {
    // A full-stack run may address any pack its case declared, not just the default.
    let staged = staged(
        &[(PackKind::InstrumentBank, "gm-lite@0.1.0")],
        &[
            ("gm-lite", "0.1.0", PackKind::InstrumentBank),
            ("cinematic", "0.1.0", PackKind::InstrumentBank),
            ("synthwave", "0.1.0", PackKind::InstrumentBank),
        ],
    );
    let pack = staged
        .select(PackKind::InstrumentBank, Some("synthwave@0.1.0"))
        .expect("a declared bank resolves")
        .expect("it is staged");
    assert_eq!(pack.reference(), "synthwave@0.1.0");

    // A bare name pins no version and takes the staged one.
    let pack = staged
        .select(PackKind::InstrumentBank, Some("cinematic"))
        .expect("a bare name resolves")
        .expect("it is staged");
    assert_eq!(pack.version, "0.1.0");
}

#[test]
fn a_kind_the_run_holds_no_pack_of_selects_nothing() {
    // An sfx-synth case declares no packs at all, which is an empty library rather
    // than a failure.
    let staged = staged(&[], &[]);
    assert_eq!(staged.select(PackKind::SamplePack, None), Ok(None));
}

#[test]
fn a_pack_the_run_was_not_staged_with_is_an_error_naming_what_it_holds() {
    let err = full_stack()
        .select(PackKind::SamplePack, Some("arcade@0.1.0"))
        .expect_err("an undeclared pack is a failure, not a substitution");
    assert!(err.contains("arcade@0.1.0"), "{err}");
    // The message names the run's own palette, never one it does not carry.
    assert!(err.contains("combat-core@0.1.0"), "{err}");
    assert!(err.contains("gm-lite@0.1.0"), "{err}");
}

#[test]
fn a_pack_of_the_other_kind_is_an_error() {
    let err = full_stack()
        .select(PackKind::InstrumentBank, Some("combat-core"))
        .expect_err("a sample pack cannot answer for an instrument bank");
    assert!(err.contains("combat-core"), "{err}");
    assert!(err.contains("sample-pack"), "{err}");
}

#[test]
fn a_pin_on_a_version_the_run_was_not_staged_with_is_an_error() {
    let err = full_stack()
        .select(PackKind::SamplePack, Some("combat-core@0.2.0"))
        .expect_err("a stale pin is a failure, not a silent substitution");
    assert!(err.contains("combat-core@0.2.0"), "{err}");
    assert!(err.contains("combat-core@0.1.0"), "{err}");
}

#[test]
fn a_ref_naming_no_pack_selects_nothing() {
    let err = full_stack()
        .select(PackKind::SamplePack, Some("@0.1.0"))
        .expect_err("a version with no name addresses no pack");
    assert!(err.contains("names no pack"), "{err}");
}

#[test]
fn a_default_naming_an_unstaged_pack_is_an_error() {
    let staged = staged(
        &[(PackKind::SamplePack, "arcade@0.1.0")],
        &[("combat-core", "0.1.0", PackKind::SamplePack)],
    );
    let err = staged
        .select(PackKind::SamplePack, None)
        .expect_err("a default the run does not hold is a failure");
    assert!(err.contains("arcade@0.1.0"), "{err}");
}

#[test]
fn an_empty_palette_reports_that_the_run_was_staged_with_none() {
    let err = staged(&[], &[])
        .select(PackKind::SamplePack, Some("combat-core@0.1.0"))
        .expect_err("a named pack with nothing staged is a failure");
    assert!(err.contains("no audio packs"), "{err}");
}

#[test]
fn the_manifest_round_trips_through_its_json_shape() {
    let json = serde_json::to_string(&full_stack()).unwrap();
    // The kinds are the identifiers a pack manifest and the lint use.
    assert!(json.contains("\"sample-pack\""), "{json}");
    assert!(json.contains("\"instrument-bank\""), "{json}");
    let parsed: StagedPacks = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, full_stack());
}

#[test]
fn a_run_staged_with_no_audio_loads_no_manifest() {
    let root = tempfile::tempdir().unwrap();
    unsafe { std::env::remove_var(AUDIO_ROOT_ENV) };
    assert_eq!(StagedPacks::load(root.path()), Ok(None));
}

#[test]
fn a_manifest_written_against_another_contract_is_an_error() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path().join(PACKS_MANIFEST),
        r#"{ "contract": 2, "defaults": {}, "packs": [] }"#,
    )
    .unwrap();
    let err = StagedPacks::load(root.path()).expect_err("a contract this build does not read");
    assert!(err.contains("contract 2"), "{err}");
}

#[test]
fn a_fetched_store_is_read_as_a_palette_of_its_own() {
    // The host-side escape hatch: a store fetched onto a checkout is an audio root,
    // and the first pack of each kind is that kind's default.
    let root = tempfile::tempdir().unwrap();
    write_store_pack(root.path(), "combat-core", "0.1.0", "sample-pack");
    write_store_pack(root.path(), "cinematic", "0.1.0", "instrument-bank");
    write_store_pack(root.path(), "gm-lite", "0.1.0", "instrument-bank");
    unsafe { std::env::set_var(AUDIO_ROOT_ENV, root.path()) };

    let staged = StagedPacks::load(root.path())
        .expect("the store enumerates")
        .expect("it carries packs");
    assert_eq!(staged.packs.len(), 3);
    assert_eq!(
        staged
            .defaults
            .get(&PackKind::SamplePack)
            .map(String::as_str),
        Some("combat-core@0.1.0")
    );
    assert_eq!(
        staged
            .defaults
            .get(&PackKind::InstrumentBank)
            .map(String::as_str),
        Some("cinematic@0.1.0")
    );
    assert_eq!(
        staged
            .select(PackKind::InstrumentBank, Some("gm-lite@0.1.0"))
            .unwrap()
            .map(StagedPack::reference),
        Some("gm-lite@0.1.0".to_string())
    );
}

#[test]
fn a_store_pack_declaring_no_kind_cannot_be_addressed() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join(pack_dir("combat-core", "0.1.0"));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("pack.toml"), "name = \"combat-core\"\n").unwrap();
    unsafe { std::env::set_var(AUDIO_ROOT_ENV, root.path()) };

    let err = StagedPacks::load(root.path()).expect_err("an unclassifiable pack is a failure");
    assert!(err.contains("kind"), "{err}");
}

#[test]
fn the_root_honours_the_environment_override() {
    unsafe { std::env::set_var(AUDIO_ROOT_ENV, "/elsewhere/audio") };
    assert_eq!(StagedPacks::root(), Path::new("/elsewhere/audio"));
    unsafe { std::env::remove_var(AUDIO_ROOT_ENV) };
    assert_eq!(StagedPacks::root(), Path::new(AUDIO_ROOT));
}

#[test]
fn a_ref_splits_into_name_and_version() {
    assert_eq!(pack_name("combat-core@0.2.0"), "combat-core");
    assert_eq!(pack_version("combat-core@0.2.0"), Some("0.2.0"));
    assert_eq!(pack_name("combat-core"), "combat-core");
    assert_eq!(pack_version("combat-core"), None);
    // A trailing `@` pins no version.
    assert_eq!(pack_version("combat-core@"), None);
}
