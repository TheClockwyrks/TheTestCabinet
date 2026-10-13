//! Serving a run's file from the public bucket when the backend store has no
//! copy of it.
//!
//! A refresh that [confirms](crate::db::confirmation_holds) a published run
//! records the run's [file manifest](crate::db::MediaManifest): each file of the
//! run, under the name the store and the routes know it by, with the object that
//! holds its bytes. The run file routes (`GET /runs/{id}/proof/{file}` and its
//! siblings) answer from the store while it holds the file, and call
//! [`read_through`] when it does not. The consoles and the arena therefore keep
//! requesting the same routes whether a run's files are on the volume or only in
//! the bucket.
//!
//! One rule shapes every outcome here: a fault is never answered as `404`. A
//! `404` says the run has no such file, and a reader acts on that (a console
//! shows "not recorded", the arena drops a controller). A bucket that did not
//! answer, and a manifest that could not be read, say nothing about the file.

use axum::body::Body;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use test_cabinet_core::content_labels::ContentLabels;
use test_cabinet_core::r2::{R2Client, R2Object};

use super::AppState;
use crate::error::{ApiError, BackendError};

/// The bucket the run file routes read a confirmed run's files back from.
#[derive(Clone)]
pub struct RunFileBucket {
    /// The client that reads the bucket.
    client: R2Client,
    /// The bucket as a media confirmation names it
    /// ([`media_bucket_identity`](crate::artifacts::media_bucket_identity)). A
    /// manifest is read only for a run confirmed against this name, so a file is
    /// never fetched from a bucket other than the one its manifest was made in.
    identity: &'static str,
}

impl RunFileBucket {
    /// A reader of the bucket `client` reaches, which confirmations name
    /// `identity`.
    pub fn new(client: R2Client, identity: &'static str) -> Self {
        Self { client, identity }
    }

    /// The bucket as a media confirmation names it.
    pub fn identity(&self) -> &'static str {
        self.identity
    }
}

/// Record that a file of run `run_id` was just written into the store by an
/// upload ([`Db::note_run_file_uploaded`](crate::db::Db::note_run_file_uploaded)).
///
/// A run that was confirmed is unevaluated again, so a refresh is requested to
/// export what the upload brought and confirm the run again; until it has, the
/// state sweep removes nothing of the run. A published run with no confirmation
/// is stamped as changed and a refresh requested for it as well, so a refresh
/// already evaluating it does not confirm it without the file. A run whose files
/// the sweep had removed stops reading as one with none. An upload for any other
/// run, which is every driver mirroring a run for the first time, writes nothing.
///
/// A record that cannot be written does not fail the upload: the file is
/// stored, and the sweep removes a file only when the run's manifest records an
/// object for it, so a confirmation left in place deletes nothing it should not.
pub(super) async fn file_uploaded(state: &AppState, run_id: &str) {
    match state.db.note_run_file_uploaded(run_id).await {
        Ok(crate::db::UploadedOver::Nothing) => {}
        Ok(crate::db::UploadedOver::Reclaim) => tracing::info!(
            run.id = %run_id,
            "a file was uploaded for a run whose files the state sweep had removed; \
             cleared the reclaim record"
        ),
        Ok(crate::db::UploadedOver::Published) => {
            tracing::debug!(
                run.id = %run_id,
                "a file was uploaded for a published run; requested a snapshot refresh \
                 to evaluate it"
            );
            state.publisher.queue_refresh();
        }
        Ok(crate::db::UploadedOver::Confirmation) => {
            tracing::info!(
                run.id = %run_id,
                "a file was uploaded for a confirmed run; cleared its media confirmation \
                 and requested a snapshot refresh to evaluate it again"
            );
            state.publisher.queue_refresh();
        }
        Err(error) => tracing::warn!(
            run.id = %run_id,
            %error,
            "could not record a file upload on its run; the run's media confirmation is as it was"
        ),
    }
}

/// Answer for the file of run `run_id` the store names `name` (see
/// [`MediaManifestFile::name`](crate::db::MediaManifestFile::name)) after the
/// store failed to read it with `store_miss`, labelling the body by `labels`.
///
/// The store's own answer stands, unchanged, whenever the bucket has nothing to
/// add to it:
///
/// - the store refused the request for another reason than the file not being
///   there (a name that is not a safe path segment);
/// - the backend has no bucket;
/// - the run has no manifest, which is every run no refresh has confirmed in
///   the configured bucket under the current definition;
/// - the manifest does not name the file, or records it as unrecoverable with
///   no transcoded copy;
/// - the bucket answered that it holds no object under the key. The manifest
///   says otherwise, so this is logged at `error`.
///
/// Otherwise the object is passed through as it arrives. A transcoded video is
/// answered with its recorded bytes, and with the mp4 made from them only when
/// the manifest records the recording itself as unrecoverable.
///
/// A manifest that cannot be read answers `500` and a bucket that fails answers
/// `502`, neither of which a reader can take for a file the run does not have.
pub(super) async fn read_through(
    state: &AppState,
    run_id: &str,
    name: &str,
    labels: fn(&str) -> ContentLabels,
    store_miss: BackendError,
) -> Result<Response, ApiError> {
    if !matches!(store_miss, BackendError::NotFound(_)) {
        return Err(store_miss.into());
    }
    let Some(bucket) = state.run_files.as_ref() else {
        return Err(store_miss.into());
    };
    let Some(manifest) = state
        .db
        .run_media_manifest(run_id, Some(bucket.identity))
        .await
        .map_err(ApiError::from)?
    else {
        return Err(store_miss.into());
    };
    // The recorded bytes when the bucket holds them, else the mp4 made from a
    // recording that exists nowhere any more.
    let Some(key) = manifest
        .file(name)
        .and_then(|file| file.key.as_deref().or(file.transcoded_key.as_deref()))
    else {
        return Err(store_miss.into());
    };
    match bucket.client.get_object(key).await {
        Ok(Some(object)) => Ok(object_response(labels(key), object)),
        Ok(None) => {
            tracing::error!(
                run.id = %run_id,
                file = %name,
                r2.key = %key,
                bucket = bucket.identity,
                "the bucket holds no object under a key the run's manifest names"
            );
            Err(store_miss.into())
        }
        Err(err) => {
            tracing::warn!(
                run.id = %run_id,
                file = %name,
                r2.key = %key,
                "reading a run's file from the bucket failed ({err})"
            );
            Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                "bucket_unavailable",
                format!("`{name}` of run `{run_id}` could not be read from the bucket"),
            ))
        }
    }
}

/// The response that passes `object` through under `labels`.
///
/// The body is streamed: each part is sent as the bucket delivers it and nothing
/// is held, so an object of any size costs the backend one part of memory. A read
/// that fails part-way ends the response short of its stated length, which a
/// client reports as a failed transfer.
fn object_response(labels: ContentLabels, object: R2Object) -> Response {
    let length = object.content_length();
    let body = Body::from_stream(futures_util::stream::try_unfold(
        object,
        |mut object| async move {
            let chunk = object.chunk().await?;
            Ok::<_, test_cabinet_core::Error>(chunk.map(|chunk| (chunk, object)))
        },
    ));
    let mut response = (StatusCode::OK, body).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static(labels.content_type),
    );
    if let Some(encoding) = labels.content_encoding {
        headers.insert(
            header::CONTENT_ENCODING,
            header::HeaderValue::from_static(encoding),
        );
    }
    if let Some(length) = length {
        headers.insert(header::CONTENT_LENGTH, header::HeaderValue::from(length));
    }
    response
}

#[cfg(test)]
#[path = "run_files.test.rs"]
mod tests;
