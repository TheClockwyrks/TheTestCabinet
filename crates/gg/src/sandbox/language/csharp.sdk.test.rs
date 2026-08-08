//! What holds the embedded SDK to the directory it was copied from.

use std::collections::BTreeSet;
use std::path::PathBuf;

use super::{SDK_DIRECTORY, SDK_SOURCES};

/// The SDK's source directory in this checkout.
fn sdk_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/gg-sandbox-csharp/src/Gg")
        .canonicalize()
        .expect("the C# SDK's sources are in this checkout")
}

/// Every `.cs` under `src/Gg/`, as a path relative to it.
fn on_disk() -> BTreeSet<String> {
    let root = sdk_root();
    let mut found = BTreeSet::new();
    let mut stack = vec![root.clone()];
    while let Some(directory) = stack.pop() {
        for entry in std::fs::read_dir(&directory)
            .expect("the SDK directory is readable")
            .flatten()
        {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|extension| extension == "cs") {
                let relative = path
                    .strip_prefix(&root)
                    .expect("every file found under the root is under the root");
                found.insert(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    found
}

#[test]
fn every_sdk_source_in_the_repository_is_embedded() {
    // `include_str!` notices a file whose *contents* changed and never one nobody added to the
    // array, so a new SDK file is silently absent from every compile until this fails: the
    // reflector would document functions the compiler had never seen, which is a catalogue
    // describing calls a program cannot make.
    let embedded: BTreeSet<String> = SDK_SOURCES
        .iter()
        .map(|source| source.name.to_string())
        .collect();
    assert_eq!(
        embedded,
        on_disk(),
        "the embedded C# SDK and packages/gg-sandbox-csharp/src/Gg/ have drifted apart"
    );
}

#[test]
fn every_embedded_source_is_the_file_on_disk() {
    // The other half: that what is embedded under a name really is that file. `include_str!` makes
    // this true by construction today, and it is asserted because the path in the macro is a string
    // — one wrong relative path would embed a *different* SDK file twice, and every count above
    // would still balance.
    let root = sdk_root();
    for source in SDK_SOURCES {
        let path = root.join(source.name);
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{} is readable: {error}", path.display()));
        assert_eq!(
            text, source.text,
            "the embedded copy of {} is not the file on disk",
            source.name
        );
    }
}

#[test]
fn the_sdk_is_written_somewhere_a_diagnostic_can_be_told_apart_from_the_models() {
    // The whole of how `classify` tells gg's own defect from the model's is where the file is, so
    // the directory has to be a name no model-facing path can be confused with — and the program is
    // deliberately not inside it.
    assert_eq!(SDK_DIRECTORY, "sdk");
    assert!(
        SDK_SOURCES
            .iter()
            .all(|source| !source.name.starts_with('/') && !source.name.contains("..")),
        "an SDK source escapes the directory it is written into"
    );
}
