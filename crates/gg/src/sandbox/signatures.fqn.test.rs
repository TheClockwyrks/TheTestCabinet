//! Tests for [the name rule](super) — the one scheme eleven disagreeing spellings are held to.
//!
//! The centre of this file is [`the_rule_accepts_every_arms_own_spelling`], a table of the **name
//! shapes** the rule must accept, one family per arm that motivated it. It was written before any
//! arm had committed a name, because the rule had to be shown to accept
//! `gg.files.Workspace#readFile(String)` and a labelled Swift selector *in advance* — discovering
//! it does not is a redesign rather than a fix.
//!
//! **That prediction phase is over**: all eleven arms are converted, and what each of them really
//! emits is held against the committed artifacts by
//! [`every_registered_arms_names_are_whole`]. So the table is no longer a claim about what any arm
//! spells — several rows predate the module vocabulary settling on `files`, `delegation` and the
//! rest, and one row is a shape no arm ships at all. It is kept, and re-titled, because the shapes
//! are the subject: a scheme that stops accepting `#`-separated members or a `/` inside a module
//! prefix has been narrowed, and narrowing it is what this table is here to notice.

use serde_json::Value;

use super::*;
use crate::sandbox::signatures::fixture;

/// One row of the shape table: a name, the module it hangs off, what a program calls it, its
/// receiver where it has one, and which of the three shapes it is.
struct Row {
    /// Which arm's *syntax family* the row is drawn from — quoted in the failure, since the whole
    /// table's value is telling you which shape the rule broke on. It is not an assertion that the
    /// arm spells this name; [`every_registered_arms_names_are_whole`] is what holds the arms to
    /// their committed ones.
    arm: &'static str,
    /// The fully-qualified name as that arm's reflector emits it.
    fqn: &'static str,
    /// The module path it is qualified by.
    module: &'static str,
    /// The name a program calls it by.
    name: &'static str,
    /// The declared type it hangs off, for a member.
    receiver: Option<&'static str>,
    /// Which shape it is.
    shape: Shape,
}

/// **The rule accepts every name shape an arm's syntax can produce**, across all three shapes.
///
/// Every row is a shape from the design's per-arm table, including the four that are not obviously
/// the same syntax as any other: a **labelled selector**, whose labels are part of the identity and
/// must not be read as segments; Java's `#`-separated member with a parameter list; Ruby's
/// `::`-then-`#` mix; and a `gg/fs` module path whose `/` sits *inside* the module prefix and would
/// split a name that was parsed instead of prefix-matched.
///
/// The rows that carry an arm's **committed** spelling say so; the rest are shapes the rule must
/// keep accepting whether or not an arm writes one today. The labelled selector is the clearest
/// case of the second kind: Swift's reflector deliberately emits `gg.files.readFile` and files the
/// selector nowhere, and the shape is kept because a scheme that stopped accepting it would have to
/// be redesigned rather than fixed if a future arm reflected DocC's own spelling.
#[test]
fn the_rule_accepts_every_arms_own_spelling() {
    let table = [
        // Rust — free functions in modules.
        Row {
            arm: "Rust",
            fqn: "gg::fs::read_file",
            module: "gg::fs",
            name: "read_file",
            receiver: None,
            shape: Shape::Standalone,
        },
        Row {
            arm: "Rust",
            fqn: "gg::fs::FileRead",
            module: "gg::fs",
            name: "FileRead",
            receiver: None,
            shape: Shape::Type,
        },
        Row {
            arm: "Rust",
            fqn: "gg::agents::SubagentHandle::send",
            module: "gg::agents",
            name: "send",
            receiver: Some("SubagentHandle"),
            shape: Shape::Member,
        },
        // C++ — namespaces, and `snake_case` types, so a type and a function differ by word order.
        Row {
            arm: "C++",
            fqn: "gg::files::read_file",
            module: "gg::files",
            name: "read_file",
            receiver: None,
            shape: Shape::Standalone,
        },
        Row {
            arm: "C++",
            fqn: "gg::files::file_read",
            module: "gg::files",
            name: "file_read",
            receiver: None,
            shape: Shape::Type,
        },
        Row {
            arm: "C++",
            fqn: "gg::agents::subagent_handle::send",
            module: "gg::agents",
            name: "send",
            receiver: Some("subagent_handle"),
            shape: Shape::Member,
        },
        // Swift — the arm's real committed names, measured from
        // `guests/swift.signatures.json`: a caseless enum per module, and no argument labels in a
        // name anywhere.
        Row {
            arm: "Swift",
            fqn: "gg.files.readFile",
            module: "gg.files",
            name: "readFile",
            receiver: None,
            shape: Shape::Standalone,
        },
        Row {
            arm: "Swift",
            fqn: "gg.files.FileRead",
            module: "gg.files",
            name: "FileRead",
            receiver: None,
            shape: Shape::Type,
        },
        Row {
            arm: "Swift",
            fqn: "gg.delegation.SubagentHandle.send",
            module: "gg.delegation",
            name: "send",
            receiver: Some("SubagentHandle"),
            shape: Shape::Member,
        },
        // A **labelled selector**, which is DocC's own spelling of the row above it and which no
        // arm emits — see this test's doc for why the shape is kept anyway. The labels are part of
        // the identity and must not be read as segments.
        Row {
            arm: "a labelled selector",
            fqn: "GgFiles.readFile(_:offset:limit:)",
            module: "GgFiles",
            name: "readFile",
            receiver: None,
            shape: Shape::Standalone,
        },
        // C# — a static class that *is* the module, so a standalone function has no receiver. The
        // three rows below are the arm's real committed names rather than anticipated ones: this is
        // the arm that has been converted, and its catalogue is held to the same rule by
        // `every_registered_arms_names_are_whole`.
        Row {
            arm: "C#",
            fqn: "Gg.Files.ReadFile",
            module: "Gg.Files",
            name: "ReadFile",
            receiver: None,
            shape: Shape::Standalone,
        },
        Row {
            arm: "C#",
            fqn: "Gg.Files.DirEntry",
            module: "Gg.Files",
            name: "DirEntry",
            receiver: None,
            shape: Shape::Type,
        },
        Row {
            arm: "C#",
            fqn: "Gg.Delegation.SubagentHandle.Send",
            module: "Gg.Delegation",
            name: "Send",
            receiver: Some("SubagentHandle"),
            shape: Shape::Member,
        },
        // Java — no standalone functions at all: what Rust spells as one is a member here.
        Row {
            arm: "Java",
            fqn: "gg.files.Workspace#readFile(String)",
            module: "gg.files",
            name: "readFile",
            receiver: Some("Workspace"),
            shape: Shape::Member,
        },
        Row {
            arm: "Java",
            fqn: "gg.files.FileRead",
            module: "gg.files",
            name: "FileRead",
            receiver: None,
            shape: Shape::Type,
        },
        Row {
            arm: "Java",
            fqn: "gg.agents.Subagent#send(String)",
            module: "gg.agents",
            name: "send",
            receiver: Some("Subagent"),
            shape: Shape::Member,
        },
        // Kotlin — real top-level functions in real packages.
        Row {
            arm: "Kotlin",
            fqn: "gg.files.readFile",
            module: "gg.files",
            name: "readFile",
            receiver: None,
            shape: Shape::Standalone,
        },
        Row {
            arm: "Kotlin",
            fqn: "gg.agents.SubagentHandle.send",
            module: "gg.agents",
            name: "send",
            receiver: Some("SubagentHandle"),
            shape: Shape::Member,
        },
        // TypeScript / JavaScript — the module path contains a `/`, inside the prefix.
        Row {
            arm: "TypeScript",
            fqn: "gg/fs.readFile",
            module: "gg/fs",
            name: "readFile",
            receiver: None,
            shape: Shape::Standalone,
        },
        Row {
            arm: "TypeScript",
            fqn: "gg/fs.FileRead",
            module: "gg/fs",
            name: "FileRead",
            receiver: None,
            shape: Shape::Type,
        },
        Row {
            arm: "JavaScript",
            fqn: "gg/agents.SubagentHandle#wait",
            module: "gg/agents",
            name: "wait",
            receiver: Some("SubagentHandle"),
            shape: Shape::Member,
        },
        // Python.
        Row {
            arm: "Python",
            fqn: "gg.fs.read_file",
            module: "gg.fs",
            name: "read_file",
            receiver: None,
            shape: Shape::Standalone,
        },
        Row {
            arm: "Python",
            fqn: "gg.agents.SubagentHandle.wait",
            module: "gg.agents",
            name: "wait",
            receiver: Some("SubagentHandle"),
            shape: Shape::Member,
        },
        // Ruby — `::` down to the type and `#` to the instance method, in one name.
        Row {
            arm: "Ruby",
            fqn: "GG::Fs.read_file",
            module: "GG::Fs",
            name: "read_file",
            receiver: None,
            shape: Shape::Standalone,
        },
        Row {
            arm: "Ruby",
            fqn: "GG::Fs::FileRead",
            module: "GG::Fs",
            name: "FileRead",
            receiver: None,
            shape: Shape::Type,
        },
        Row {
            arm: "Ruby",
            fqn: "GG::Agents::SubagentHandle#wait",
            module: "GG::Agents",
            name: "wait",
            receiver: Some("SubagentHandle"),
            shape: Shape::Member,
        },
        // PureScript — free functions over values, and no member shape at all by design.
        Row {
            arm: "PureScript",
            fqn: "Gg.Fs.readFile",
            module: "Gg.Fs",
            name: "readFile",
            receiver: None,
            shape: Shape::Standalone,
        },
        Row {
            arm: "PureScript",
            fqn: "Gg.Fs.FileRead",
            module: "Gg.Fs",
            name: "FileRead",
            receiver: None,
            shape: Shape::Type,
        },
    ];

    for Row {
        arm,
        fqn,
        module,
        name,
        receiver,
        shape,
    } in table
    {
        assert_eq!(
            check(fqn, module, name, receiver, shape),
            Ok(()),
            "the rule rejects {arm}'s own spelling `{fqn}`"
        );
    }
}

/// **A name that is not qualified by its module is refused** — the first invariant, and the one that
/// makes two modules able to offer a `close` each.
#[test]
fn a_bare_name_is_not_a_fully_qualified_name() {
    assert_eq!(
        check("read_file", "gg::fs", "read_file", None, Shape::Standalone),
        Err(Fault::NotModuleQualified {
            fqn: "read_file".to_string(),
            module: "gg::fs".to_string(),
        })
    );
}

/// **A module path that is a prefix of a longer identifier does not qualify anything.**
///
/// `gg::fsx::read` begins with the characters of `gg::fs`, and a rule that matched on prefix alone
/// would file it under the filesystem module and then answer lookups with it. What follows the
/// prefix has to be a separator.
#[test]
fn a_module_path_matched_by_accident_does_not_qualify() {
    assert_eq!(
        check("gg::fsx::read", "gg::fs", "read", None, Shape::Standalone),
        Err(Fault::NotModuleQualified {
            fqn: "gg::fsx::read".to_string(),
            module: "gg::fs".to_string(),
        })
    );
}

/// **The three shapes are counted, not guessed**: a member's name carries its receiver, and a
/// standalone one does not.
#[test]
fn the_shape_is_the_number_of_segments_after_the_module() {
    let member_as_standalone = check(
        "gg::views::OpenView::close",
        "gg::views",
        "close",
        None,
        Shape::Standalone,
    );
    assert!(matches!(
        member_as_standalone,
        Err(Fault::WrongShape { ref found, .. }) if found == &["OpenView".to_string(), "close".to_string()]
    ));

    let standalone_as_member = check(
        "gg::views::close",
        "gg::views",
        "close",
        Some("OpenView"),
        Shape::Member,
    );
    assert!(matches!(
        standalone_as_member,
        Err(Fault::WrongShape { ref found, .. }) if found == &["close".to_string()]
    ));
}

/// **The name a program writes is the tail of the key**, so a model can get from what it read to
/// what it types.
#[test]
fn a_name_that_does_not_end_in_the_call_is_refused() {
    assert_eq!(
        check(
            "gg::fs::read_file",
            "gg::fs",
            "readFile",
            None,
            Shape::Standalone
        ),
        Err(Fault::NameMismatch {
            fqn: "gg::fs::read_file".to_string(),
            name: "readFile".to_string(),
        })
    );
}

/// **A member names its receiver**, and a member that names a different one is refused rather than
/// filed under whatever the name happened to say.
#[test]
fn a_member_that_names_another_receiver_is_refused() {
    assert_eq!(
        check(
            "gg::views::FileView::close",
            "gg::views",
            "close",
            Some("OpenView"),
            Shape::Member
        ),
        Err(Fault::ReceiverMismatch {
            fqn: "gg::views::FileView::close".to_string(),
            receiver: "OpenView".to_string(),
        })
    );
    assert_eq!(
        check(
            "gg::views::OpenView::close",
            "gg::views",
            "close",
            None,
            Shape::Member
        ),
        Err(Fault::MethodWithoutReceiver {
            fqn: "gg::views::OpenView::close".to_string(),
        })
    );
}

/// **The clean v2 fixture passes the whole catalogue check**, which is what makes every damaged
/// variant below a statement about the damage rather than about the fixture.
#[test]
fn the_v2_fixture_names_are_whole() {
    assert_eq!(faults(fixture::v2()), Vec::<String>::new());
}

/// **Every registered arm's names hold together**, whichever schema it committed.
///
/// For an arm that emits no fully-qualified names the rule is inert — there is nothing to be right
/// or wrong about, and a gate that invented names to check would be checking gg's invention rather
/// than the arm's. For a converted arm it is the whole rule: module-qualified, of the right shape
/// for its kind, unique, and every type and member reference resolving to something the same
/// catalogue declares.
#[test]
fn every_registered_arms_names_are_whole() {
    assert_eq!(faults(fixture::v1()), Vec::<String>::new());
    for language in crate::sandbox::all_languages() {
        // Inert for an arm that emits no fully-qualified names at all, and the real rule for one
        // that does — the same call either way, which is what keeps a converted arm from needing a
        // second test to be held by.
        assert_eq!(
            faults(language.catalogue()),
            Vec::<String>::new(),
            "{}'s names do not hold together",
            language.display_name()
        );
    }
}

/// **A name qualified by a module nobody declared is a name whose prefix means nothing.**
#[test]
fn a_module_the_catalogue_does_not_declare_is_caught() {
    let damaged = fixture::v2_with(|json| {
        json["functions"][3]["module"] = "filesystem".into();
    });
    let faults = faults(damaged);
    assert_eq!(faults.len(), 1, "{faults:?}");
    assert!(
        faults[0].contains("filesystem") && faults[0].contains("does not declare"),
        "{faults:?}"
    );
}

/// **Two entries may not claim one name**, because a name is what a documentation view is keyed by.
#[test]
fn a_duplicated_name_is_caught() {
    let damaged = fixture::v2_with(|json| {
        json["functions"][0]["fqn"] = "gg::files::read_file".into();
        json["functions"][0]["module"] = "files".into();
        json["functions"][0]["name"] = "read_file".into();
    });
    let faults = faults(damaged);
    assert!(
        faults
            .iter()
            .any(|fault| fault.contains("two entries claim")),
        "{faults:?}"
    );
}

/// **A type reference that resolves to nothing is caught** — the property that makes opening a
/// function's return types a lookup rather than a guess.
#[test]
fn a_reference_to_an_undeclared_type_is_caught() {
    let damaged = fixture::v2_with(|json| {
        json["functions"][3]["returns"][0] = "gg::files::FileReadResult".into();
    });
    let faults = faults(damaged);
    assert_eq!(faults.len(), 1, "{faults:?}");
    assert!(
        faults[0].contains("gg::files::FileReadResult"),
        "{faults:?}"
    );
}

/// **A type's menu of member functions is a menu of things that can be opened**: one that lists a
/// function the catalogue does not carry is caught.
#[test]
fn a_member_function_that_is_not_catalogued_is_caught() {
    let damaged = fixture::v2_with(|json| {
        json["types"][1]["memberFunctions"][0]["fqn"] = "gg::views::OpenView::reopen".into();
    });
    let faults = faults(damaged);
    assert_eq!(faults.len(), 1, "{faults:?}");
    assert!(faults[0].contains("reopen"), "{faults:?}");
}

/// **A type with no name of its own cannot be opened**, and is reported rather than skipped.
#[test]
fn a_type_without_a_name_is_caught() {
    let damaged = fixture::v2_with(|json| {
        json["types"][0]["fqn"] = Value::Null;
    });
    let faults = faults(damaged);
    assert!(
        faults
            .iter()
            .any(|fault| fault.contains("has no fully-qualified name")),
        "{faults:?}"
    );
}
