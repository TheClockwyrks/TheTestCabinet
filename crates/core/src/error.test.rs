//! The suite runtime's errors, read through this crate's.

use super::Error;

/// Each suite runtime error converts to the variant of the same name, and reads the
/// same through it, so a failure raised in `test_cabinet_suites` is reported exactly
/// as it was when that code was core's.
#[test]
fn a_suite_runtime_error_reads_the_same_through_the_core_error() {
    use test_cabinet_suites::Error as Suites;

    let cases = [
        (
            Suites::InvalidTestSuite {
                suite: "carom".to_string(),
                version: "v1.0.0".to_string(),
                file: "test-cases/ball.toml".to_string(),
                detail: "the suite offers no such definition".to_string(),
            },
            "test suite `carom@v1.0.0` is invalid: test-cases/ball.toml: the suite offers no \
             such definition",
        ),
        (
            Suites::PromptRender {
                slug: "carom".to_string(),
                version: "v1.0.0".to_string(),
                detail: "no such field".to_string(),
            },
            "rendering the prompt for `carom@v1.0.0`: no such field",
        ),
        (
            Suites::Engine("unknown engine `x`".to_string()),
            "resolving the engine: unknown engine `x`",
        ),
        (
            Suites::Seeding("no version".to_string()),
            "seeding the run repository: no version",
        ),
        (
            Suites::Io(std::io::Error::other("disk full")),
            "host I/O: disk full",
        ),
    ];
    for (suites, expected) in cases {
        assert_eq!(
            suites.to_string(),
            expected,
            "the suite runtime's own message"
        );
        let core = Error::from(suites);
        assert_eq!(core.to_string(), expected, "the same message through core");
    }

    assert!(matches!(
        Error::from(Suites::Engine(String::new())),
        Error::Engine(_)
    ));
    assert!(matches!(
        Error::from(Suites::Seeding(String::new())),
        Error::Seeding(_)
    ));
    assert!(matches!(
        Error::from(Suites::Io(std::io::Error::other("x"))),
        Error::Io(_)
    ));
    assert!(matches!(
        Error::from(Suites::PromptRender {
            slug: String::new(),
            version: String::new(),
            detail: String::new(),
        }),
        Error::PromptRender { .. }
    ));
    assert!(matches!(
        Error::from(Suites::InvalidTestSuite {
            suite: String::new(),
            version: String::new(),
            file: String::new(),
            detail: String::new(),
        }),
        Error::InvalidTestSuite { .. }
    ));
}
