//! Discord Rich Presence over Discord's local named-pipe IPC.
//!
//! Presence policy stays in TypeScript; this module owns only the transport,
//! lifecycle and the exact activity envelope Discord expects.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const INITIAL_RETRY_DELAY: Duration = Duration::from_secs(5);
const DISCONNECTED_RETRY_DELAY: Duration = Duration::from_secs(1);
const IDLE_WAIT: Duration = Duration::from_secs(60);

/// Accepts a millisecond timestamp as either an integer or a float.
///
/// The renderer computes `Date.now() - currentTime * 1000`, and `currentTime`
/// is a float number of seconds, so the result is virtually never integral.
/// A plain `Option<i64>` rejected that with "invalid type: floating point",
/// and serde fails the WHOLE struct on one bad field — so the title, the
/// artist and the artwork were all discarded, leaving Discord showing nothing
/// but the placeholder set at connect time. The renderer now rounds at the
/// source; this stays tolerant so the same slip cannot silently erase the
/// presence again.
fn deserialize_millis<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Millis {
        Int(i64),
        Float(f64),
    }

    Ok(
        Option::<Millis>::deserialize(deserializer)?.map(|value| match value {
            Millis::Int(value) => value,
            Millis::Float(value) => value.round() as i64,
        }),
    )
}

/// A presence button. Discord accepts at most two, and rejects an empty label
/// or url outright — a malformed one costs the whole activity, so they are
/// filtered rather than forwarded blindly.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct DiscordButton {
    pub label: String,
    pub url: String,
}

const MAX_BUTTONS: usize = 2;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscordActivity {
    pub details: Option<String>,
    pub state: Option<String>,
    pub large_image: Option<String>,
    pub large_text: Option<String>,
    pub small_image: Option<String>,
    pub small_text: Option<String>,
    #[serde(default, deserialize_with = "deserialize_millis")]
    pub start_timestamp: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_millis")]
    pub end_timestamp: Option<i64>,
    /// Present in the Electron build and lost in the port: the renderer has
    /// always sent a button, and this struct simply had nowhere to put it, so
    /// it was dropped on every update.
    #[serde(default)]
    pub buttons: Option<Vec<DiscordButton>>,
}

impl DiscordActivity {
    fn default_placeholder() -> Self {
        let start_timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|duration| i64::try_from(duration.as_millis()).ok());
        Self {
            details: Some("Nemora".to_owned()),
            state: None,
            large_image: Some("nemora_logo".to_owned()),
            large_text: None,
            small_image: Some("song_artwork".to_owned()),
            small_text: None,
            start_timestamp,
            end_timestamp: None,
            buttons: None,
        }
    }

    fn rpc_value(&self) -> Value {
        let mut activity = Map::new();
        if let Some(value) = &self.details {
            activity.insert("details".to_owned(), Value::String(value.clone()));
        }
        if let Some(value) = &self.state {
            activity.insert("state".to_owned(), Value::String(value.clone()));
        }

        let mut assets = Map::new();
        for (key, value) in [
            ("large_image", &self.large_image),
            ("large_text", &self.large_text),
            ("small_image", &self.small_image),
            ("small_text", &self.small_text),
        ] {
            if let Some(value) = value {
                assets.insert(key.to_owned(), Value::String(value.clone()));
            }
        }
        if !assets.is_empty() {
            activity.insert("assets".to_owned(), Value::Object(assets));
        }

        let mut timestamps = Map::new();
        if let Some(value) = self.start_timestamp {
            timestamps.insert("start".to_owned(), Value::Number(value.into()));
        }
        if let Some(value) = self.end_timestamp {
            timestamps.insert("end".to_owned(), Value::Number(value.into()));
        }
        if !timestamps.is_empty() {
            activity.insert("timestamps".to_owned(), Value::Object(timestamps));
        }

        if let Some(buttons) = &self.buttons {
            let usable: Vec<Value> = buttons
                .iter()
                .filter(|button| !button.label.trim().is_empty() && !button.url.trim().is_empty())
                .take(MAX_BUTTONS)
                .map(|button| json!({ "label": button.label, "url": button.url }))
                .collect();
            if !usable.is_empty() {
                activity.insert("buttons".to_owned(), Value::Array(usable));
            }
        }

        // These two fields were forced by the Electron implementation for
        // every user-supplied payload.
        activity.insert("instance".to_owned(), Value::Bool(true));
        activity.insert("type".to_owned(), Value::Number(2.into()));
        Value::Object(activity)
    }
}

/// Narrow transport seam: Discord IPC can be replaced by a deterministic fake
/// in tests and remains isolated from the command/lifecycle layer.
trait DiscordTransport: Send {
    fn connect(&mut self) -> Result<(), String>;
    fn set_activity(&mut self, activity: &DiscordActivity) -> Result<(), String>;
    fn disconnect(&mut self) -> Result<(), String>;
}

struct DiscordPipeTransport {
    client: discord_rich_presence::DiscordIpcClient,
}

impl DiscordPipeTransport {
    fn new(client_id: &str) -> Result<Self, String> {
        let client = discord_rich_presence::DiscordIpcClient::new(client_id)
            .map_err(|error| format!("failed to create Discord IPC client: {error}"))?;
        Ok(Self { client })
    }
}

impl DiscordTransport for DiscordPipeTransport {
    fn connect(&mut self) -> Result<(), String> {
        use discord_rich_presence::DiscordIpc;
        self.client
            .connect()
            .map_err(|error| format!("failed to connect to Discord IPC: {error}"))
    }

    fn set_activity(&mut self, activity: &DiscordActivity) -> Result<(), String> {
        use discord_rich_presence::DiscordIpc;
        static NONCE: AtomicU64 = AtomicU64::new(1);
        let nonce = format!(
            "nemora-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::Relaxed)
        );
        self.client
            .send(
                json!({
                    "cmd": "SET_ACTIVITY",
                    "args": {
                        "pid": std::process::id(),
                        "activity": activity.rpc_value(),
                    },
                    "nonce": nonce,
                }),
                1,
            )
            .map_err(|error| format!("failed to set Discord activity: {error}"))
    }

    fn disconnect(&mut self) -> Result<(), String> {
        use discord_rich_presence::DiscordIpc;
        self.client
            .close()
            .map_err(|error| format!("failed to close Discord IPC: {error}"))
    }
}

type TransportFactory = fn(&str) -> Result<Box<dyn DiscordTransport>, String>;

fn production_transport(client_id: &str) -> Result<Box<dyn DiscordTransport>, String> {
    DiscordPipeTransport::new(client_id)
        .map(|transport| Box::new(transport) as Box<dyn DiscordTransport>)
}

enum WorkerRequest {
    Connect(String),
    SetActivity(DiscordActivity),
    Disconnect(Sender<Result<(), String>>),
}

struct WorkerState {
    client_id: Option<String>,
    transport: Option<Box<dyn DiscordTransport>>,
    last_activity: Option<DiscordActivity>,
    retry_at: Option<Instant>,
}

impl WorkerState {
    fn new() -> Self {
        Self {
            client_id: None,
            transport: None,
            last_activity: None,
            retry_at: None,
        }
    }

    fn is_connected(&self) -> bool {
        self.transport.is_some()
    }

    fn replace_client(&mut self, client_id: String, factory: TransportFactory) {
        if self.client_id.as_deref() == Some(client_id.as_str()) && self.is_connected() {
            return;
        }
        self.close_transport();
        self.client_id = Some(client_id);
        if self.last_activity.is_none() {
            self.last_activity = Some(DiscordActivity::default_placeholder());
        }
        self.try_connect(factory, INITIAL_RETRY_DELAY);
    }

    fn try_connect(&mut self, factory: TransportFactory, retry_delay: Duration) {
        let Some(client_id) = self.client_id.as_deref() else {
            self.retry_at = None;
            return;
        };
        let result = factory(client_id).and_then(|mut transport| {
            transport.connect()?;
            if let Some(activity) = &self.last_activity {
                transport.set_activity(activity)?;
            }
            self.transport = Some(transport);
            Ok(())
        });
        if result.is_ok() {
            self.retry_at = None;
        } else {
            self.close_transport();
            self.retry_at = Some(Instant::now() + retry_delay);
        }
    }

    fn set_activity(&mut self, activity: DiscordActivity) {
        self.last_activity = Some(activity);
        let failed = match (&mut self.transport, &self.last_activity) {
            (Some(transport), Some(activity)) => transport.set_activity(activity).is_err(),
            _ => false,
        };
        if failed {
            self.close_transport();
            if self.client_id.is_some() {
                self.retry_at = Some(Instant::now() + DISCONNECTED_RETRY_DELAY);
            }
        }
    }

    fn disconnect(&mut self) -> Result<(), String> {
        self.client_id = None;
        self.retry_at = None;
        self.transport
            .take()
            .map_or(Ok(()), |mut transport| transport.disconnect())
    }

    fn close_transport(&mut self) {
        if let Some(mut transport) = self.transport.take() {
            let _ = transport.disconnect();
        }
    }

    fn wait_duration(&self) -> Duration {
        self.retry_at
            .map(|deadline| deadline.saturating_duration_since(Instant::now()))
            .unwrap_or(IDLE_WAIT)
    }
}

fn worker_loop(receiver: Receiver<WorkerRequest>, factory: TransportFactory) {
    let mut state = WorkerState::new();
    loop {
        match receiver.recv_timeout(state.wait_duration()) {
            Ok(WorkerRequest::Connect(client_id)) => state.replace_client(client_id, factory),
            Ok(WorkerRequest::SetActivity(activity)) => state.set_activity(activity),
            Ok(WorkerRequest::Disconnect(reply)) => {
                let _ = reply.send(state.disconnect());
            }
            Err(RecvTimeoutError::Timeout) => {
                if state
                    .retry_at
                    .is_some_and(|deadline| deadline <= Instant::now())
                {
                    state.try_connect(factory, INITIAL_RETRY_DELAY);
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                let _ = state.disconnect();
                return;
            }
        }
    }
}

struct DiscordController {
    sender: Sender<WorkerRequest>,
}

impl DiscordController {
    fn start() -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel();
        thread::Builder::new()
            .name("nemora-discord-ipc".to_owned())
            .spawn(move || worker_loop(receiver, production_transport))
            .map_err(|error| format!("failed to start Discord IPC worker: {error}"))?;
        Ok(Self { sender })
    }

    fn send(&self, request: WorkerRequest) -> Result<(), String> {
        self.sender
            .send(request)
            .map_err(|_| "Discord IPC worker is not available".to_owned())
    }
}

static CONTROLLER: OnceLock<Result<DiscordController, String>> = OnceLock::new();

fn controller() -> Result<&'static DiscordController, String> {
    CONTROLLER
        .get_or_init(DiscordController::start)
        .as_ref()
        .map_err(Clone::clone)
}

#[tauri::command]
pub async fn discord_connect(client_id: String) -> Result<(), String> {
    let client_id = client_id.trim();
    if client_id.is_empty() {
        return Err("Discord Client ID not found".to_owned());
    }
    controller()?.send(WorkerRequest::Connect(client_id.to_owned()))
}

#[tauri::command]
pub async fn discord_set_activity(activity: DiscordActivity) -> Result<(), String> {
    controller()?.send(WorkerRequest::SetActivity(activity))
}

#[tauri::command]
pub async fn discord_disconnect() -> Result<(), String> {
    let (reply, response) = mpsc::channel();
    controller()?.send(WorkerRequest::Disconnect(reply))?;
    response
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "timed out while closing Discord IPC".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::{DiscordActivity, DiscordButton, DiscordTransport, WorkerState};
    use serde_json::json;
    use std::{
        cell::RefCell,
        sync::{Arc, Mutex},
    };

    #[derive(Default)]
    struct Calls {
        connects: usize,
        disconnects: usize,
        activities: Vec<DiscordActivity>,
        fail_activity: bool,
    }

    struct FakeTransport(Arc<Mutex<Calls>>);

    impl DiscordTransport for FakeTransport {
        fn connect(&mut self) -> Result<(), String> {
            self.0.lock().unwrap().connects += 1;
            Ok(())
        }

        fn set_activity(&mut self, activity: &DiscordActivity) -> Result<(), String> {
            let mut calls = self.0.lock().unwrap();
            calls.activities.push(activity.clone());
            if calls.fail_activity {
                Err("pipe disconnected".to_owned())
            } else {
                Ok(())
            }
        }

        fn disconnect(&mut self) -> Result<(), String> {
            self.0.lock().unwrap().disconnects += 1;
            Ok(())
        }
    }

    thread_local! {
        static CALLS: RefCell<Option<Arc<Mutex<Calls>>>> = const { RefCell::new(None) };
    }

    fn fake_factory(_client_id: &str) -> Result<Box<dyn DiscordTransport>, String> {
        CALLS.with(|calls| {
            calls
                .borrow()
                .as_ref()
                .cloned()
                .map(|calls| Box::new(FakeTransport(calls)) as Box<dyn DiscordTransport>)
                .ok_or_else(|| "fake calls were not installed".to_owned())
        })
    }

    fn install_calls() -> Arc<Mutex<Calls>> {
        let calls = Arc::new(Mutex::new(Calls::default()));
        CALLS.with(|slot| *slot.borrow_mut() = Some(calls.clone()));
        calls
    }

    fn activity() -> DiscordActivity {
        DiscordActivity {
            details: Some("Track".to_owned()),
            state: Some("Artist".to_owned()),
            large_image: Some("cover".to_owned()),
            large_text: Some("Album".to_owned()),
            small_image: Some("song_artwork".to_owned()),
            small_text: None,
            start_timestamp: Some(123),
            end_timestamp: Some(456),
            buttons: Some(vec![DiscordButton {
                label: "Nemora on GitHub".to_owned(),
                url: "https://github.com/Nikenmar/Nemora".to_owned(),
            }]),
        }
    }

    #[test]
    fn payload_forces_listening_and_instance_fields() {
        assert_eq!(
            activity().rpc_value(),
            json!({
                "details": "Track",
                "state": "Artist",
                "assets": {
                    "large_image": "cover",
                    "large_text": "Album",
                    "small_image": "song_artwork"
                },
                "timestamps": { "start": 123, "end": 456 },
                "buttons": [
                    { "label": "Nemora on GitHub", "url": "https://github.com/Nikenmar/Nemora" }
                ],
                "instance": true,
                "type": 2
            })
        );
    }

    #[test]
    fn a_float_timestamp_no_longer_discards_the_whole_activity() {
        // The renderer computes start from `currentTime`, a float number of
        // seconds. A strict i64 rejected the value AND every sibling field
        // with it, which is why Discord showed only the placeholder.
        let parsed: DiscordActivity = serde_json::from_value(json!({
            "details": "Track",
            "state": "Artist",
            "startTimestamp": 1_786_481_075_136.4_f64,
            "endTimestamp": 1_786_481_275_136_i64
        }))
        .expect("a float timestamp must be accepted");

        assert_eq!(parsed.details.as_deref(), Some("Track"));
        assert_eq!(parsed.state.as_deref(), Some("Artist"));
        assert_eq!(parsed.start_timestamp, Some(1_786_481_075_136));
        assert_eq!(parsed.end_timestamp, Some(1_786_481_275_136));
    }

    #[test]
    fn malformed_buttons_are_dropped_rather_than_failing_the_activity() {
        let mut activity = activity();
        activity.buttons = Some(vec![
            DiscordButton {
                label: "  ".to_owned(),
                url: "https://example.invalid".to_owned(),
            },
            DiscordButton {
                label: "Good".to_owned(),
                url: "https://github.com/Nikenmar/Nemora".to_owned(),
            },
            DiscordButton {
                label: "Third".to_owned(),
                url: "https://example.invalid".to_owned(),
            },
        ]);

        let payload = activity.rpc_value();
        let buttons = payload["buttons"].as_array().expect("buttons survive");
        assert_eq!(buttons.len(), 2, "Discord accepts at most two buttons");
        assert_eq!(buttons[0]["label"], "Good");
        assert_eq!(payload["details"], "Track");
    }

    #[test]
    fn default_payload_matches_the_electron_presence() {
        let payload = DiscordActivity::default_placeholder().rpc_value();
        assert_eq!(payload["details"], "Nemora");
        assert_eq!(payload["assets"]["large_image"], "nemora_logo");
        assert_eq!(payload["assets"]["small_image"], "song_artwork");
        assert_eq!(payload["instance"], true);
        assert_eq!(payload["type"], 2);
        assert!(payload["timestamps"]["start"].is_number());
    }

    #[test]
    fn connect_is_idempotent_and_disconnect_stops_retrying() {
        let calls = install_calls();
        let mut state = WorkerState::new();
        state.replace_client("client".to_owned(), fake_factory);
        state.replace_client("client".to_owned(), fake_factory);
        assert_eq!(calls.lock().unwrap().connects, 1);
        assert!(state.is_connected());

        state.disconnect().unwrap();
        assert!(!state.is_connected());
        assert!(state.client_id.is_none());
        assert!(state.retry_at.is_none());
        assert_eq!(calls.lock().unwrap().disconnects, 1);
    }

    #[test]
    fn a_broken_pipe_preserves_activity_and_schedules_reconnect() {
        let calls = install_calls();
        let mut state = WorkerState::new();
        state.replace_client("client".to_owned(), fake_factory);
        calls.lock().unwrap().fail_activity = true;

        let expected = activity();
        state.set_activity(expected.clone());
        assert_eq!(state.last_activity, Some(expected));
        assert!(!state.is_connected());
        assert!(state.retry_at.is_some());
    }
}
