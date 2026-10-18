//! The library database: one SQLite file per device. Schema contract: `spec/schema-v1.md`.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::{Error, Result};
use crate::ids;

/// The schema this build creates and understands.
pub const SCHEMA_VERSION: i64 = 1;

const SCHEMA_V1: &str = include_str!("db/schema_v1.sql");

pub struct Db {
    conn: Connection,
    /// Bumped by every write that can change what a list shows; cached orders older than it are
    /// recomputed.
    generation: AtomicU64,
    /// Ordered variant ids per list (scope + sort), computed once per generation.
    orders: Mutex<HashMap<String, (u64, Arc<Vec<i64>>)>>,
}

impl Db {
    /// Opens or creates the database at `path`, migrating it to [`SCHEMA_VERSION`].
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Self::init(conn)
    }

    /// A private database in memory, for tests and dry runs.
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        let mut db = Self { conn, generation: AtomicU64::new(0), orders: Mutex::new(HashMap::new()) };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&mut self) -> Result<()> {
        let version: i64 = self.conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(Error::SchemaTooNew { found: version, supported: SCHEMA_VERSION });
        }
        if version == 0 {
            let tx = self.conn.transaction()?;
            tx.execute_batch(SCHEMA_V1)?;
            tx.execute("INSERT INTO meta (key, value) VALUES ('device_id', ?1)", params![ids::random()])?;
            tx.execute("INSERT INTO meta (key, value) VALUES ('created_at', ?1)", params![now_ms().to_string()])?;
            tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            tx.commit()?;
        }
        // Later versions: back up with VACUUM INTO, then apply each numbered migration in order.
        Ok(())
    }

    pub fn device_id(&self) -> Result<String> {
        Ok(self.conn.query_row("SELECT value FROM meta WHERE key = 'device_id'", [], |row| row.get(0))?)
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| row.get(0)).optional()?)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Marks cached list orders stale. Called by every write that changes the library or plays.
    pub(crate) fn touch(&self) {
        self.generation.fetch_add(1, Ordering::Relaxed);
    }

    /// The cached order for `key`, or `compute`'s result, cached for the current generation.
    pub(crate) fn cached_order(
        &self,
        key: &str,
        compute: impl FnOnce(&Connection) -> Result<Vec<i64>>,
    ) -> Result<Arc<Vec<i64>>> {
        let generation = self.generation.load(Ordering::Relaxed);
        if let Some((g, ids)) = self.orders.lock().unwrap().get(key)
            && *g == generation
        {
            return Ok(Arc::clone(ids));
        }
        let ids = Arc::new(compute(&self.conn)?);
        self.orders.lock().unwrap().insert(key.to_owned(), (generation, Arc::clone(&ids)));
        Ok(ids)
    }

    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }

    pub(crate) fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_file_matches_the_spec() {
        let spec = include_str!("../spec/schema-v1.md");
        let start = spec.find("```sql\n").expect("the spec has an SQL block") + "```sql\n".len();
        let end = start + spec[start..].find("```").expect("the SQL block ends");
        assert_eq!(&spec[start..end], SCHEMA_V1, "src/db/schema_v1.sql drifted from spec/schema-v1.md");
    }

    #[test]
    fn a_new_database_gets_the_schema_and_a_device_id() {
        let db = Db::open_in_memory().unwrap();
        let version: i64 = db.conn().pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        assert!(ids::decode(&db.device_id().unwrap()).is_some());
    }

    #[test]
    fn reopening_keeps_the_device_id() {
        let dir = std::env::temp_dir().join(format!("nemora-db-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("nemora.db");
        let first = Db::open(&path).unwrap().device_id().unwrap();
        let second = Db::open(&path).unwrap().device_id().unwrap();
        assert_eq!(first, second);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_newer_schema_is_refused() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION + 1).unwrap();
        assert!(matches!(Db::init(conn), Err(Error::SchemaTooNew { .. })));
    }
}
