//! Tests for choosing the public store. Each impl is exercised against its stub
//! service beside its client (`blob.stub.test.rs`, `r2.stub.test.rs`).

use std::sync::Arc;

use super::*;
use crate::blob::{BlobClient, Credential};

fn runs() -> BlobClient {
    BlobClient::with_credential(
        "devstoreaccount1",
        "http://azurite:10000/devstoreaccount1",
        "runs",
        Credential::SharedKey(Arc::new(b"key".to_vec())),
        reqwest::Client::new(),
    )
}

#[test]
fn an_r2_config_opens_the_bucket() {
    let config = PublicStoreConfig::R2(R2Config {
        account_id: "acct".to_string(),
        bucket: "bucket".to_string(),
        access_key_id: "id".to_string(),
        secret_access_key: "secret".to_string(),
        endpoint: "https://acct.r2.cloudflarestorage.com".to_string(),
        region: "auto".to_string(),
    });
    assert_eq!(open(&config, &runs()).kind(), "r2");
}

#[test]
fn a_blob_config_opens_a_container_of_the_run_account() {
    let config = PublicStoreConfig::Blob {
        container: "public".to_string(),
    };
    assert_eq!(open(&config, &runs()).kind(), "blob");
}
