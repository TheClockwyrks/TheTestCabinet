use super::*;

#[test]
fn substitute_fills_owner_and_tag() {
    let input = "image: ghcr.io/REPLACE_OWNER/tcab-backend:REPLACE_TAG";
    let out = substitute(input);
    assert!(
        out.contains(&format!(
            "ghcr.io/{GHCR_OWNER}/tcab-backend:{}",
            image_tag()
        )),
        "owner and tag should be filled in: {out}"
    );
    assert!(!out.contains("REPLACE_OWNER"));
    assert!(!out.contains("REPLACE_TAG"));
}

#[test]
fn substitute_leaves_registry_match_key() {
    // `REPLACE_REGISTRY` is a kustomize match key the images block rewrites, not a
    // value to fill in — it must survive substitution untouched.
    let input = "  - name: REPLACE_REGISTRY/tcab-backend";
    assert_eq!(substitute(input), input);
}

#[test]
fn image_tag_defaults_to_latest_without_build_stamp() {
    // With no compile-time TCAB_DESKTOP_IMAGE_TAG, local builds pull `:latest`.
    if option_env!("TCAB_DESKTOP_IMAGE_TAG").is_none() {
        assert_eq!(image_tag(), "latest");
    }
}

#[test]
fn normalize_docker_host_prefixes_bare_socket_paths() {
    // A bare filesystem path (Podman's usual `podman info` output) gains a scheme.
    assert_eq!(
        normalize_docker_host("/run/user/1000/podman/podman.sock\n"),
        Some("unix:///run/user/1000/podman/podman.sock".to_string())
    );
}

#[test]
fn normalize_docker_host_takes_the_first_machine_line() {
    // `podman machine inspect --format` prints one socket per machine; the first
    // non-empty line wins (and gains a scheme).
    assert_eq!(
        normalize_docker_host(
            "\n/var/folders/x/podman-machine-default-api.sock\n/other/machine.sock\n"
        ),
        Some("unix:///var/folders/x/podman-machine-default-api.sock".to_string())
    );
}

#[test]
fn normalize_docker_host_passes_through_an_explicit_scheme() {
    // A value that already carries a scheme (e.g. a TCP socket) is left untouched.
    assert_eq!(
        normalize_docker_host("  unix:///tmp/podman.sock  "),
        Some("unix:///tmp/podman.sock".to_string())
    );
    assert_eq!(
        normalize_docker_host("tcp://127.0.0.1:2375"),
        Some("tcp://127.0.0.1:2375".to_string())
    );
}

#[test]
fn normalize_docker_host_rejects_empty_output() {
    // No socket reported (blank or whitespace) yields no override.
    assert_eq!(normalize_docker_host(""), None);
    assert_eq!(normalize_docker_host("  \n "), None);
}

#[test]
fn strip_ansi_removes_color_codes_but_keeps_text() {
    // The exact shape k3d (logrus) emits: a red SGR around the level, a reset, then
    // a literal `[0000]` timestamp. Only the escapes are removed; the text (brackets
    // included) survives.
    let raw = "\u{1b}[31mFATA\u{1b}[0m[0000] runtime failed to list nodes";
    assert_eq!(strip_ansi(raw), "FATA[0000] runtime failed to list nodes");
}

#[test]
fn strip_ansi_leaves_plain_text_untouched() {
    assert_eq!(
        strip_ansi("Cannot connect to the Docker daemon"),
        "Cannot connect to the Docker daemon"
    );
}

#[test]
fn extra_path_dirs_only_returns_existing_directories() {
    // The list is filtered to real directories so the exported PATH stays tidy.
    for dir in extra_path_dirs() {
        assert!(dir.is_dir(), "{} should exist", dir.display());
    }
}

#[test]
fn augmented_path_keeps_the_inherited_entries() {
    // Whatever else it appends, the augmented PATH must still contain every dir the
    // process already had on PATH (so nothing the parent could find is lost).
    let augmented = augmented_path();
    let augmented_dirs: Vec<_> = std::env::split_paths(&augmented).collect();
    if let Some(inherited) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&inherited) {
            assert!(
                augmented_dirs.contains(&dir),
                "augmented PATH dropped inherited dir {}",
                dir.display()
            );
        }
    }
}
