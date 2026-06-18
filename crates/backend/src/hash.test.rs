use super::*;

#[test]
fn sha256_hex_is_lowercase_hex_of_bytes() {
    // The empty-string SHA-256 is a fixed known vector.
    assert_eq!(
        sha256_hex(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn aggregate_is_order_independent() {
    let a = HashedFile {
        path: "Dockerfile".to_string(),
        sha256: sha256_hex(b"FROM scratch"),
        size: 12,
    };
    let b = HashedFile {
        path: "install.mjs".to_string(),
        sha256: sha256_hex(b"console.log(1)"),
        size: 14,
    };
    let forward = aggregate_content_hash(&[a.clone(), b.clone()]);
    let reversed = aggregate_content_hash(&[b, a]);
    assert_eq!(forward, reversed);
    assert!(forward.starts_with("sha256:"));
}

#[test]
fn aggregate_changes_when_a_file_changes() {
    let base = vec![HashedFile {
        path: "Dockerfile".to_string(),
        sha256: sha256_hex(b"FROM base"),
        size: 9,
    }];
    let changed = vec![HashedFile {
        path: "Dockerfile".to_string(),
        sha256: sha256_hex(b"FROM other"),
        size: 10,
    }];
    assert_ne!(
        aggregate_content_hash(&base),
        aggregate_content_hash(&changed)
    );
}

#[test]
fn aggregate_follows_the_documented_recipe() {
    // Reproduce the recipe by hand for a single file and confirm the helper
    // matches: sorted "{path}\n{sha256hex}\n" fed into one SHA-256.
    let bytes = b"hello";
    let file_hash = sha256_hex(bytes);
    let mut hasher = Sha256::new();
    hasher.update(b"Dockerfile\n");
    hasher.update(file_hash.as_bytes());
    hasher.update(b"\n");
    let expected = format!("sha256:{}", hex::encode(hasher.finalize()));

    let actual = aggregate_content_hash(&[HashedFile {
        path: "Dockerfile".to_string(),
        sha256: file_hash,
        size: bytes.len() as u64,
    }]);
    assert_eq!(actual, expected);
}
