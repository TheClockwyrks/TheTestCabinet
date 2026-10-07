//! Tests for the test suite's on-disk component cache. Each works in its own temporary directory on
//! the smallest valid component there is — the component preamble and nothing else — so none of them
//! pays a real guest's compile, and which path was taken is read from [`Materialised`] rather than
//! from a clock.

use wasmtime::{Config, Engine, OptLevel};

use super::super::{compile, engine};
use super::*;

/// A component with no sections: the magic number, the component-model version and layer.
const EMPTY_COMPONENT: &[u8] = b"\0asm\x0d\0\x01\0";

fn materialise(bytes: &[u8], directory: &Path) -> Result<Materialised, SandboxError> {
    load_or_compile(engine(), bytes, directory, compile).map(|(_, how)| how)
}

fn files_with_extension(directory: &Path, extension: &str) -> usize {
    fs::read_dir(directory)
        .map(|listing| {
            listing
                .flatten()
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .is_some_and(|found| found == extension)
                })
                .count()
        })
        .unwrap_or(0)
}

#[test]
fn bytes_are_stored_the_second_time_they_are_compiled_and_loaded_after_that() {
    let directory = tempfile::tempdir().expect("a scratch directory");
    let directory = directory.path();

    assert_eq!(
        materialise(EMPTY_COMPONENT, directory).expect("it compiles"),
        Materialised::Compiled
    );
    assert_eq!(files_with_extension(directory, "seen"), 1);
    assert_eq!(
        files_with_extension(directory, "cwasm"),
        0,
        "stored on first sight"
    );

    assert_eq!(
        materialise(EMPTY_COMPONENT, directory).expect("it compiles"),
        Materialised::CompiledAndStored
    );
    assert_eq!(
        files_with_extension(directory, "seen"),
        0,
        "the first-sighting marker was left beside the stored entry"
    );
    assert_eq!(files_with_extension(directory, "cwasm"), 1);

    for _ in 0..2 {
        assert_eq!(
            materialise(EMPTY_COMPONENT, directory).expect("it loads"),
            Materialised::Loaded
        );
    }
    assert_eq!(
        files_with_extension(directory, "staged"),
        0,
        "a staged write was left behind"
    );
}

/// An entry wasmtime refuses is compiled over, never run — and replaced, so the next process loads.
#[test]
fn a_corrupt_entry_is_compiled_over_rather_than_run() {
    let directory = tempfile::tempdir().expect("a scratch directory");
    let directory = directory.path();
    materialise(EMPTY_COMPONENT, directory).expect("it compiles");
    materialise(EMPTY_COMPONENT, directory).expect("it compiles");

    let entry = directory.join(format!("{}.cwasm", key(engine(), EMPTY_COMPONENT)));
    fs::write(&entry, b"not a compiled component").expect("the entry is writable");

    assert_eq!(
        materialise(EMPTY_COMPONENT, directory).expect("it falls back to compiling"),
        Materialised::CompiledAndStored
    );
    assert_eq!(
        materialise(EMPTY_COMPONENT, directory).expect("the replaced entry loads"),
        Materialised::Loaded
    );
}

/// A failed compile leaves no entry, so the tests that feed the engine bytes that are not a component
/// see the compiler's error every time.
#[test]
fn bytes_that_do_not_compile_are_never_stored() {
    let directory = tempfile::tempdir().expect("a scratch directory");
    let directory = directory.path();
    for _ in 0..3 {
        let error = materialise(b"this is not a wasm component", directory)
            .expect_err("garbage does not compile");
        assert!(matches!(error, SandboxError::Compile(_)), "{error:?}");
    }
    assert_eq!(files_with_extension(directory, "cwasm"), 0);
    assert_eq!(files_with_extension(directory, "seen"), 0);
}

/// Where nothing can be written, the cache is a compile every time and never an error.
#[test]
fn an_unwritable_directory_only_costs_the_compile() {
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let file = scratch.path().join("a-file");
    fs::write(&file, b"").expect("the scratch directory is writable");
    let directory = file.join("component-cache");

    for _ in 0..3 {
        assert_eq!(
            materialise(EMPTY_COMPONENT, &directory).expect("it compiles"),
            Materialised::Compiled
        );
    }
}

/// The key carries the engine's compatibility hash, so an engine configured differently — or a
/// different wasmtime — can never be handed code compiled for another.
#[test]
fn a_differently_configured_engine_keys_the_same_bytes_differently() {
    let mut config = Config::new();
    config.wasm_component_model(true);
    config.cranelift_opt_level(OptLevel::Speed);
    let other = Engine::new(&config).expect("the config is valid");

    assert_eq!(
        key(engine(), EMPTY_COMPONENT),
        key(engine(), EMPTY_COMPONENT)
    );
    assert_ne!(key(engine(), EMPTY_COMPONENT), key(&other, EMPTY_COMPONENT));
    assert_ne!(
        key(engine(), EMPTY_COMPONENT),
        key(engine(), b"\0asm\x0d\0\x01\0\0"),
        "different bytes share a key"
    );
}

#[test]
fn a_prune_removes_the_least_recently_used_entries_and_stale_markers() {
    let directory = tempfile::tempdir().expect("a scratch directory");
    let directory = directory.path();
    let now = SystemTime::now();
    let day = Duration::from_secs(24 * 60 * 60);
    let place = |name: &str, len: usize, age: Duration| {
        let path = directory.join(name);
        fs::write(&path, vec![0u8; len]).expect("the scratch directory is writable");
        File::options()
            .write(true)
            .open(&path)
            .and_then(|file| file.set_modified(now - age))
            .expect("the file's time can be set");
    };
    place("least-recent.cwasm", 100, 3 * day);
    place("most-recent.cwasm", 100, day);
    place("stale.seen", 0, 3 * day);
    place("fresh.seen", 0, Duration::ZERO);

    prune(directory, 150, 2 * day);

    let left: std::collections::BTreeSet<String> = fs::read_dir(directory)
        .expect("the directory lists")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        left,
        ["fresh.seen", "most-recent.cwasm"]
            .map(String::from)
            .into_iter()
            .collect()
    );
}
