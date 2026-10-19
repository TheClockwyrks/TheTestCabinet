//! Shared Key signing vectors. The expected signatures were computed by the
//! Azure SDK for Python (`azure-storage-blob` 12.19.0,
//! `SharedKeyCredentialPolicy.on_request`) over the same requests, so they
//! check this canonicalization against Azure's own rather than against itself.
// cspell:disable

use super::*;

/// The well-known Azurite account key (public, documented by the emulator).
const AZURITE_KEY: &str =
    "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";

const DATE: &str = "Mon, 19 Oct 2026 12:00:00 GMT";

fn key() -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(AZURITE_KEY)
        .unwrap()
}

fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
    items
        .iter()
        .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
        .collect()
}

fn sign(
    method: &str,
    account: &str,
    path: &str,
    headers: &[(&str, &str)],
    query: &[(&str, &str)],
) -> String {
    let headers = pairs(headers);
    let query = pairs(query);
    let request = SignedRequest {
        method,
        headers: &headers,
        account,
        path,
        query: &query,
    };
    signature(&key(), &string_to_sign(&request))
}

#[test]
fn a_path_style_put_blob_matches_the_sdk() {
    let signed = sign(
        "PUT",
        "devstoreaccount1",
        "/devstoreaccount1/runs/abc/g/1/implementation/a%20b.txt",
        &[
            ("x-ms-date", DATE),
            ("x-ms-version", "2023-11-03"),
            ("x-ms-blob-type", "BlockBlob"),
            ("x-ms-blob-content-type", "text/plain"),
            ("content-length", "11"),
        ],
        &[],
    );
    assert_eq!(signed, "xr158mHBjwWWQkKzGMP42r+nFUX3n1r0tLumXb5NCcg=");
}

#[test]
fn a_paged_list_with_a_delimiter_matches_the_sdk() {
    let signed = sign(
        "GET",
        "devstoreaccount1",
        "/devstoreaccount1/runs",
        &[("x-ms-date", DATE), ("x-ms-version", "2023-11-03")],
        &[
            ("restype", "container"),
            ("comp", "list"),
            ("prefix", "abc/"),
            ("delimiter", "/"),
            ("marker", "2!abc"),
        ],
    );
    assert_eq!(signed, "mmA14cYONHgEZZVOsTmsxempQvABdXuyeH5G/Ktt1h8=");
}

#[test]
fn a_put_block_matches_the_sdk() {
    let signed = sign(
        "PUT",
        "myaccount",
        "/mycontainer/big.bin",
        &[
            ("x-ms-date", DATE),
            ("x-ms-version", "2023-11-03"),
            ("content-length", "4"),
        ],
        &[("comp", "block"), ("blockid", "MDAwMDAwMDAwMQ==")],
    );
    assert_eq!(signed, "bdvCHjucxzBjS31SQcj9kDn7i62Mip+FPHwQ7AX4j2w=");
}

#[test]
fn a_ranged_get_matches_the_sdk() {
    let signed = sign(
        "GET",
        "myaccount",
        "/mycontainer/big.bin",
        &[
            ("x-ms-date", DATE),
            ("x-ms-version", "2023-11-03"),
            ("x-ms-range", "bytes=0-99"),
        ],
        &[],
    );
    assert_eq!(signed, "25hpNb9DVW9HHcd5eJEr0RvueZr747gPTKW/C+TrrHY=");
}

#[test]
fn the_canonicalized_resource_follows_the_documented_examples() {
    // Azure's "Shared Key: canonicalized resource" examples: query names lower
    // case and sorted, repeated values comma-joined in sorted order.
    let query = pairs(&[
        ("restype", "container"),
        ("comp", "list"),
        ("include", "snapshots"),
        ("include", "metadata"),
        ("include", "uncommittedblobs"),
    ]);
    let request = SignedRequest {
        method: "GET",
        headers: &[],
        account: "myaccount",
        path: "/mycontainer",
        query: &query,
    };
    let sts = string_to_sign(&request);
    assert!(
        sts.ends_with(
            "/myaccount/mycontainer\ncomp:list\ninclude:metadata,snapshots,uncommittedblobs\nrestype:container"
        ),
        "{sts}"
    );
}

#[test]
fn a_zero_content_length_is_signed_empty() {
    let with_zero = pairs(&[("content-length", "0"), ("x-ms-version", "v")]);
    let without = pairs(&[("x-ms-version", "v")]);
    let sts = |headers: &[(String, String)]| {
        string_to_sign(&SignedRequest {
            method: "PUT",
            headers,
            account: "a",
            path: "/c",
            query: &[],
        })
    };
    assert_eq!(sts(&with_zero), sts(&without));
    assert!(sts(&without).starts_with("PUT\n\n\n\n\n\n\n\n\n\n\n\nx-ms-version:v\n/a/c"));
}

#[test]
fn encode_keeps_unreserved_and_optionally_slashes() {
    assert_eq!(encode("a b/c~d_e.f-g", true), "a%20b/c~d_e.f-g");
    assert_eq!(encode("a/b!", false), "a%2Fb%21");
}
