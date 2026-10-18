//! Tests for the test suite's on-disk store of prepared programs. Each works in its own temporary
//! directory with a stand-in build function that counts its calls, so none of them runs a
//! toolchain, and which path was taken is read from [`Obtained`] rather than from a clock.

use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Barrier};
use std::thread;

use super::*;

const IDENTITY: Identity<'static> = Identity {
    language: "kotlin",
    compiler: "kotlinc 2.0 at /opt/kotlin",
    inputs: &[("sdk.jar", b"the sdk"), ("driver.kt", b"the driver")],
};

const SOURCE: &str = "fun main() = println(1)";

fn module(name: &str, source: &str) -> CodeModule {
    CodeModule {
        name: name.to_owned(),
        source: source.to_owned(),
    }
}

/// [`load_or_build`] with a build function that counts its calls and answers `answer`.
fn obtain(
    directory: &Path,
    identity: &Identity<'_>,
    source: &str,
    modules: &[CodeModule],
    builds: &AtomicUsize,
    answer: Result<Vec<u8>, PrepareFailure>,
) -> (Result<Vec<u8>, PrepareFailure>, Obtained) {
    load_or_build(directory, identity, source, modules, || {
        builds.fetch_add(1, Ordering::SeqCst);
        answer
    })
}

fn files_with_extension(directory: &Path, extension: &str) -> Vec<PathBuf> {
    fs::read_dir(directory)
        .map(|listing| {
            listing
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|found| found == extension))
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn the_store_lives_under_the_crates_out_dir() {
    assert_eq!(
        directory(),
        Path::new(env!("OUT_DIR")).join("prepared-cache")
    );
}

#[test]
fn a_component_is_built_once_and_loaded_after_that() {
    let directory = tempfile::tempdir().expect("a scratch directory");
    let directory = directory.path();
    let builds = AtomicUsize::new(0);

    let first = obtain(
        directory,
        &IDENTITY,
        SOURCE,
        &[],
        &builds,
        Ok(b"component".to_vec()),
    );
    assert_eq!(first, (Ok(b"component".to_vec()), Obtained::Built));
    assert_eq!(files_with_extension(directory, "entry").len(), 1);

    let second = load_or_build(directory, &IDENTITY, SOURCE, &[], || {
        panic!("a stored entry was built again")
    });
    assert_eq!(second, (Ok(b"component".to_vec()), Obtained::Loaded));
    assert_eq!(builds.load(Ordering::SeqCst), 1);
}

#[test]
fn a_model_facing_failure_is_stored_and_loaded_back_whole() {
    for failure in [
        PrepareError::Syntax("1:1 expected an expression".to_owned()),
        PrepareError::Compile("2:5 unresolved reference: foo".to_owned()),
        PrepareError::Unsupported("a module that exports nothing".to_owned()),
    ] {
        let directory = tempfile::tempdir().expect("a scratch directory");
        let directory = directory.path();
        let builds = AtomicUsize::new(0);
        let answer = Err(PrepareFailure::Program(failure.clone()));

        let first = obtain(directory, &IDENTITY, SOURCE, &[], &builds, answer);
        assert_eq!(first.1, Obtained::Built);
        let second = load_or_build(directory, &IDENTITY, SOURCE, &[], || {
            panic!("a stored rejection was built again")
        });
        assert_eq!(
            second,
            (Err(PrepareFailure::Program(failure)), Obtained::Loaded)
        );
    }
}

#[test]
fn a_toolchain_or_lowering_failure_is_never_stored() {
    for failure in [
        PrepareFailure::Toolchain("kotlinc was killed by signal 9".to_owned()),
        PrepareFailure::Lowering("the surface did not compile".to_owned()),
    ] {
        let directory = tempfile::tempdir().expect("a scratch directory");
        let directory = directory.path();
        let builds = AtomicUsize::new(0);

        for _ in 0..2 {
            let obtained = obtain(
                directory,
                &IDENTITY,
                SOURCE,
                &[],
                &builds,
                Err(failure.clone()),
            );
            assert_eq!(obtained, (Err(failure.clone()), Obtained::Built));
        }
        assert_eq!(
            builds.load(Ordering::SeqCst),
            2,
            "a stored failure was read back"
        );
        assert!(files_with_extension(directory, "entry").is_empty());

        let recovered = obtain(directory, &IDENTITY, SOURCE, &[], &builds, Ok(vec![1]));
        assert_eq!(recovered, (Ok(vec![1]), Obtained::Built));
    }
}

#[test]
fn a_corrupt_or_partial_entry_is_rebuilt_and_replaced() {
    let directory = tempfile::tempdir().expect("a scratch directory");
    let directory = directory.path();
    let builds = AtomicUsize::new(0);
    let component = b"a component of some length".to_vec();
    let stored = obtain(
        directory,
        &IDENTITY,
        SOURCE,
        &[],
        &builds,
        Ok(component.clone()),
    );
    assert_eq!(stored.1, Obtained::Built);
    let [entry] = files_with_extension(directory, "entry")
        .try_into()
        .expect("one entry");
    let whole = fs::read(&entry).expect("the entry reads");

    let damaged: [Vec<u8>; 4] = [
        Vec::new(),
        whole[..whole.len() / 2].to_vec(),
        {
            let mut flipped = whole.clone();
            flipped[MAGIC.len() + 12] ^= 0xff;
            flipped
        },
        b"not an entry at all, and long enough to hold a digest".to_vec(),
    ];
    for contents in damaged {
        fs::write(&entry, contents).expect("the entry is overwritten");
        let rebuilt = obtain(
            directory,
            &IDENTITY,
            SOURCE,
            &[],
            &builds,
            Ok(component.clone()),
        );
        assert_eq!(rebuilt, (Ok(component.clone()), Obtained::Built));
        let loaded = load_or_build(directory, &IDENTITY, SOURCE, &[], || {
            panic!("the rebuilt entry was not stored")
        });
        assert_eq!(loaded, (Ok(component.clone()), Obtained::Loaded));
    }
}

#[test]
fn any_change_to_what_shapes_the_output_misses() {
    let directory = tempfile::tempdir().expect("a scratch directory");
    let directory = directory.path();
    let builds = AtomicUsize::new(0);
    let modules = [
        module("geometry", "fun area() = 1"),
        module("text", "fun s() = 2"),
    ];
    let base = obtain(directory, &IDENTITY, SOURCE, &modules, &builds, Ok(vec![0]));
    assert_eq!(base.1, Obtained::Built);

    let other_inputs: &[(&str, &[u8])] =
        &[("sdk.jar", b"another sdk"), ("driver.kt", b"the driver")];
    let renamed_inputs: &[(&str, &[u8])] =
        &[("sdk2.jar", b"the sdk"), ("driver.kt", b"the driver")];
    let identities = [
        Identity {
            language: "swift",
            ..IDENTITY
        },
        Identity {
            compiler: "kotlinc 2.1 at /opt/kotlin",
            ..IDENTITY
        },
        Identity {
            compiler: "kotlinc 2.0 at /elsewhere",
            ..IDENTITY
        },
        Identity {
            inputs: other_inputs,
            ..IDENTITY
        },
        Identity {
            inputs: renamed_inputs,
            ..IDENTITY
        },
        Identity {
            inputs: &IDENTITY.inputs[..1],
            ..IDENTITY
        },
    ];
    for (index, identity) in identities.iter().enumerate() {
        let answer = Ok(vec![u8::try_from(index + 1).expect("a small index")]);
        let obtained = obtain(directory, identity, SOURCE, &modules, &builds, answer);
        assert_eq!(
            obtained.1,
            Obtained::Built,
            "identity {index} hit another's entry"
        );
    }

    let module_sets = [
        vec![],
        vec![module("geometry", "fun area() = 1")],
        vec![
            module("text", "fun s() = 2"),
            module("geometry", "fun area() = 1"),
        ],
        vec![
            module("geometry", "fun area() = 3"),
            module("text", "fun s() = 2"),
        ],
        vec![
            module("shapes", "fun area() = 1"),
            module("text", "fun s() = 2"),
        ],
    ];
    for (index, modules) in module_sets.iter().enumerate() {
        let obtained = obtain(directory, &IDENTITY, SOURCE, modules, &builds, Ok(vec![9]));
        assert_eq!(
            obtained.1,
            Obtained::Built,
            "module set {index} hit another's entry"
        );
    }

    let obtained = obtain(
        directory,
        &IDENTITY,
        "fun main() = println(2)",
        &modules,
        &builds,
        Ok(vec![7]),
    );
    assert_eq!(obtained.1, Obtained::Built, "another source hit the entry");

    let again = load_or_build(directory, &IDENTITY, SOURCE, &modules, || {
        panic!("the unchanged inputs missed")
    });
    assert_eq!(again, (Ok(vec![0]), Obtained::Loaded));
}

#[test]
fn fields_are_framed_so_moving_text_between_them_misses() {
    let directory = tempfile::tempdir().expect("a scratch directory");
    let directory = directory.path();
    let builds = AtomicUsize::new(0);
    let pairs = [[module("ab", "c")], [module("a", "bc")]];
    for modules in &pairs {
        let obtained = obtain(directory, &IDENTITY, SOURCE, modules, &builds, Ok(vec![1]));
        assert_eq!(obtained.1, Obtained::Built);
    }
    let split = [Identity {
        language: "kot",
        compiler: "linkotlinc 2.0 at /opt/kotlin",
        ..IDENTITY
    }];
    for identity in &split {
        let obtained = obtain(directory, identity, SOURCE, &[], &builds, Ok(vec![1]));
        assert_eq!(obtained.1, Obtained::Built);
    }
    let base = obtain(directory, &IDENTITY, SOURCE, &[], &builds, Ok(vec![1]));
    assert_eq!(base.1, Obtained::Built);
}

#[test]
fn concurrent_askers_of_one_key_build_it_once() {
    const ASKERS: usize = 8;
    let directory = Arc::new(tempfile::tempdir().expect("a scratch directory"));
    let builds = Arc::new(AtomicUsize::new(0));
    let start = Arc::new(Barrier::new(ASKERS));
    let askers: Vec<_> = (0..ASKERS)
        .map(|_| {
            let (directory, builds, start) = (directory.clone(), builds.clone(), start.clone());
            thread::spawn(move || {
                start.wait();
                load_or_build(directory.path(), &IDENTITY, SOURCE, &[], || {
                    builds.fetch_add(1, Ordering::SeqCst);
                    Ok(b"shared".to_vec())
                })
            })
        })
        .collect();
    let results: Vec<_> = askers
        .into_iter()
        .map(|asker| asker.join().expect("an asker panicked"))
        .collect();

    assert_eq!(
        builds.load(Ordering::SeqCst),
        1,
        "more than one asker built the key"
    );
    assert!(
        results
            .iter()
            .all(|(result, _)| result == &Ok(b"shared".to_vec()))
    );
    let built = results
        .iter()
        .filter(|(_, how)| *how == Obtained::Built)
        .count();
    assert_eq!(built, 1);
}

#[test]
fn an_unusable_directory_falls_back_to_building() {
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let directory = scratch.path().join("not-a-directory");
    fs::write(&directory, b"a file where the store's directory belongs").expect("the file writes");
    let builds = AtomicUsize::new(0);

    for _ in 0..2 {
        let obtained = obtain(&directory, &IDENTITY, SOURCE, &[], &builds, Ok(vec![3]));
        assert_eq!(obtained, (Ok(vec![3]), Obtained::Built));
    }
    assert_eq!(builds.load(Ordering::SeqCst), 2);
}

#[test]
fn a_prune_removes_the_least_recently_used_entries_and_stale_staged_files() {
    let directory = tempfile::tempdir().expect("a scratch directory");
    let directory = directory.path();
    let now = SystemTime::now();
    let aged = |name: &str, len: usize, age: u64| {
        let path = directory.join(name);
        fs::write(&path, vec![0; len]).expect("the file writes");
        File::options()
            .write(true)
            .open(&path)
            .and_then(|file| file.set_modified(now - Duration::from_secs(age)))
            .expect("the file's time is set");
        path
    };
    let oldest = aged("a.entry", 100, 300);
    let oldest_lock = aged("a.lock", 0, 300);
    let middle = aged("b.entry", 100, 200);
    let newest = aged("c.entry", 100, 100);
    let stale = aged("d.1-0.staged", 10, 3_000);
    let fresh = aged("e.1-0.staged", 10, 10);

    prune(directory, 200, Duration::from_secs(1_000));

    assert!(!oldest.exists(), "the least recently used entry was kept");
    assert!(!oldest_lock.exists(), "a pruned entry's lock file was kept");
    assert!(
        middle.exists() && newest.exists(),
        "an entry within the ceiling was removed"
    );
    assert!(!stale.exists(), "a crash's staged leftover was kept");
    assert!(
        fresh.exists(),
        "a staged file still being written was removed"
    );
}
