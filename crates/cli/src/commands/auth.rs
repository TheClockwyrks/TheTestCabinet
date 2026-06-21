//! `tcab register` / `tcab login` / `tcab logout` — account authentication.
//!
//! Accounts live in the standalone auth service; these commands register or log
//! in against it (`TCAB_AUTH_URL`) and persist the minted bearer token so the
//! mutating run commands (`push`, `review`, `publish`) can attach it. The
//! password is read from `--password` or the `TCAB_PASSWORD` environment
//! variable, so the commands stay scriptable.

use anyhow::{Result, bail};
use test_cabinet_core::{AccountsClient, LoginRequest, RegisterRequest};

use crate::cli::{LoginArgs, RegisterArgs};
use crate::config::{self, Credentials};

/// `tcab register` — create an account and log in (open self-registration).
pub async fn register(args: RegisterArgs) -> Result<()> {
    let password = resolve_password(args.password)?;
    let client = AccountsClient::new(config::auth_url());
    let response = client
        .register(&RegisterRequest {
            username: args.username,
            password,
            display_name: args.display_name,
        })
        .await?;
    config::save_credentials(&Credentials {
        token: response.token,
        username: response.account.username.clone(),
    })?;
    println!(
        "Registered and logged in as {} ({}).",
        response.account.username, response.account.display_name
    );
    Ok(())
}

/// `tcab login` — exchange credentials for a token and store it.
pub async fn login(args: LoginArgs) -> Result<()> {
    let password = resolve_password(args.password)?;
    let client = AccountsClient::new(config::auth_url());
    let response = client
        .login(&LoginRequest {
            username: args.username,
            password,
        })
        .await?;
    config::save_credentials(&Credentials {
        token: response.token,
        username: response.account.username.clone(),
    })?;
    println!(
        "Logged in as {} ({}).",
        response.account.username, response.account.display_name
    );
    Ok(())
}

/// `tcab logout` — revoke the stored token and forget it.
pub async fn logout() -> Result<()> {
    if let Some(creds) = config::load_credentials() {
        // Best-effort revocation; a server that is unreachable still lets us drop
        // the local token so the machine is logged out.
        let _ = AccountsClient::new(config::auth_url())
            .logout(&creds.token)
            .await;
    }
    config::clear_credentials()?;
    println!("Logged out.");
    Ok(())
}

/// Resolve the password from the `--password` flag or the `TCAB_PASSWORD`
/// environment variable.
fn resolve_password(flag: Option<String>) -> Result<String> {
    if let Some(password) = flag.filter(|p| !p.is_empty()) {
        return Ok(password);
    }
    if let Ok(password) = std::env::var("TCAB_PASSWORD")
        && !password.is_empty()
    {
        return Ok(password);
    }
    bail!("provide the password with --password or the TCAB_PASSWORD environment variable");
}
