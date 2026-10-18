use crate::identity::IdentityError;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("file system: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("identity: {0}")]
    Identity(#[from] IdentityError),
    #[error("tags: {0}")]
    Tags(String),
    #[error("image: {0}")]
    Image(String),
    #[error("the database has schema version {found}, newer than this build understands ({supported})")]
    SchemaTooNew { found: i64, supported: i64 },
    #[error("profile store {store} cannot be read: {reason}")]
    LegacyStore { store: String, reason: String },
}
