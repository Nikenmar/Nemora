//! A public Spotify playlist by its link, read from the page Spotify serves for embedding it in
//! other sites (`open.spotify.com/embed/playlist/<id>`): no account, no key. The page carries the
//! playlist's name, its cover and its tracks (title, artists, length) as the JSON its own script
//! starts from. It holds at most the first 100 tracks; a longer playlist comes cut, and says so.
//!
//! Nothing but the playlist's id goes to Spotify, with Nemora's own user agent.

use serde_json::Value;

use crate::playlist_match::Wanted;

/// The page shows at most this many tracks.
pub const EMBED_LIMIT: usize = 100;

#[derive(Debug, Clone, PartialEq)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    /// Who made it, as the page says.
    pub owner: Option<String>,
    pub cover_url: Option<String>,
    pub tracks: Vec<Wanted>,
    /// The page held the most it ever holds: the playlist may have more.
    pub may_be_cut: bool,
}

/// The playlist id in a link (`https://open.spotify.com/playlist/<id>?si=…`, with or without
/// `intl-xx/`, `embed/`), a URI (`spotify:playlist:<id>`) or the bare id.
pub fn playlist_id(input: &str) -> Option<String> {
    let input = input.trim();
    let is_id = |s: &str| s.len() == 22 && s.chars().all(|c| c.is_ascii_alphanumeric());
    if is_id(input) {
        return Some(input.to_owned());
    }
    if let Some(rest) = input.strip_prefix("spotify:playlist:") {
        return is_id(rest).then(|| rest.to_owned());
    }
    let without_scheme = input.trim_start_matches("https://").trim_start_matches("http://");
    let (host, path) = without_scheme.split_once('/')?;
    if !matches!(host, "open.spotify.com" | "play.spotify.com") {
        return None;
    }
    let path = path.split(['?', '#']).next().unwrap_or_default();
    let mut parts = path.split('/').filter(|p| !p.is_empty()).peekable();
    while let Some(part) = parts.next() {
        if part == "playlist" {
            return parts.next().filter(|id| is_id(id)).map(str::to_owned);
        }
    }
    None
}

pub fn embed_url(id: &str) -> String {
    format!("https://open.spotify.com/embed/playlist/{id}")
}

/// The playlist the embed page describes.
pub fn parse_embed(id: &str, html: &str) -> Result<Playlist, String> {
    let start_tag = html.find("<script id=\"__NEXT_DATA__\"").ok_or("the page has no playlist data")?;
    let body_start = start_tag + html[start_tag..].find('>').ok_or("the page has no playlist data")? + 1;
    let body_end = body_start + html[body_start..].find("</script>").ok_or("the page has no playlist data")?;
    let data: Value =
        serde_json::from_str(&html[body_start..body_end]).map_err(|e| format!("unreadable playlist data: {e}"))?;
    let entity = data
        .pointer("/props/pageProps/state/data/entity")
        .filter(|e| !e.is_null())
        .ok_or("Spotify did not give this playlist (it may be private or gone)")?;
    let text = |v: &Value, key: &str| {
        v.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned)
    };
    let name = text(entity, "name").or_else(|| text(entity, "title")).unwrap_or_else(|| "Spotify playlist".to_owned());
    // The largest picture of the cover.
    let cover_url = entity.pointer("/coverArt/sources").and_then(Value::as_array).and_then(|sources| {
        sources.iter().max_by_key(|s| s.get("width").and_then(Value::as_u64).unwrap_or(0)).and_then(|s| text(s, "url"))
    });
    let tracks: Vec<Wanted> = entity
        .get("trackList")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        // Episodes and other things a playlist can hold are not songs.
        .filter(|t| t.get("uri").and_then(Value::as_str).is_none_or(|u| u.starts_with("spotify:track:")))
        .filter_map(|t| {
            let title = text(t, "title")?;
            Some(Wanted {
                title,
                // The page joins a track's artists with commas; a name of its own may hold "&" or "/".
                artists: text(t, "subtitle")
                    .map(|s| {
                        s.replace('\u{a0}', " ")
                            .split(',')
                            .map(|a| a.trim().to_owned())
                            .filter(|a| !a.is_empty())
                            .collect()
                    })
                    .unwrap_or_default(),
                duration_ms: t.get("duration").and_then(Value::as_u64).filter(|d| *d > 0),
            })
        })
        .collect();
    let listed = entity.get("trackList").and_then(Value::as_array).map_or(0, Vec::len);
    Ok(Playlist {
        id: id.to_owned(),
        name,
        owner: text(entity, "subtitle"),
        cover_url,
        tracks,
        may_be_cut: listed >= EMBED_LIMIT,
    })
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(15)))
        .user_agent(concat!("Nemora ", env!("CARGO_PKG_VERSION"), " (https://github.com/Nikenmar/Nemora)"))
        .build()
        .into()
}

/// Reads the playlist from Spotify.
pub fn fetch(id: &str) -> Result<Playlist, String> {
    let html = agent()
        .get(&embed_url(id))
        .call()
        .map_err(|e| match e {
            ureq::Error::StatusCode(404) => "Spotify has no public playlist with this link".to_owned(),
            e => format!("Spotify did not answer: {e}"),
        })?
        .body_mut()
        .with_config()
        .limit(16 * 1024 * 1024)
        .read_to_string()
        .map_err(|e| format!("Spotify did not answer: {e}"))?;
    parse_embed(id, &html)
}

/// The cover's bytes, for the new playlist's own cover.
pub fn fetch_cover(url: &str) -> Result<Vec<u8>, String> {
    if !url.starts_with("https://") {
        return Err("not a cover address".to_owned());
    }
    agent()
        .get(url)
        .call()
        .map_err(|e| e.to_string())?
        .body_mut()
        .with_config()
        .limit(8 * 1024 * 1024)
        .read_to_vec()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_in_any_form_gives_the_id() {
        let id = "5xF83mZp9yrqC6TaTCArCT";
        for input in [
            "https://open.spotify.com/playlist/5xF83mZp9yrqC6TaTCArCT",
            "https://open.spotify.com/playlist/5xF83mZp9yrqC6TaTCArCT?si=abc123&pt=x",
            " open.spotify.com/intl-ru/playlist/5xF83mZp9yrqC6TaTCArCT ",
            "https://open.spotify.com/embed/playlist/5xF83mZp9yrqC6TaTCArCT",
            "spotify:playlist:5xF83mZp9yrqC6TaTCArCT",
            "5xF83mZp9yrqC6TaTCArCT",
        ] {
            assert_eq!(playlist_id(input).as_deref(), Some(id), "{input}");
        }
        for input in [
            "https://open.spotify.com/album/5xF83mZp9yrqC6TaTCArCT",
            "https://example.com/playlist/5xF83mZp9yrqC6TaTCArCT",
            "https://open.spotify.com/playlist/short",
            "",
        ] {
            assert_eq!(playlist_id(input), None, "{input}");
        }
    }

    fn page(tracks: usize) -> String {
        let list: Vec<Value> = (0..tracks)
            .map(|i| {
                serde_json::json!({
                    "uri": format!("spotify:track:{i:022}"),
                    "title": format!("Song {i} - Slowed"),
                    "subtitle": "gunbaou,\u{a0}LOSTOV",
                    "duration": 125_794,
                })
            })
            .chain(std::iter::once(
                serde_json::json!({ "uri": "spotify:episode:x", "title": "A podcast", "duration": 1 }),
            ))
            .collect();
        let data = serde_json::json!({ "props": { "pageProps": { "state": { "data": { "entity": {
            "type": "playlist", "name": "0to8 Promo", "subtitle": "YungFLUiD",
            "coverArt": { "sources": [ { "url": "https://image.example/small", "width": 60 }, { "url": "https://image.example/large", "width": 640 } ] },
            "trackList": list
        } } } } } });
        format!(
            "<html><head></head><body><script id=\"__NEXT_DATA__\" type=\"application/json\">{data}</script></body></html>"
        )
    }

    #[test]
    fn the_embed_page_gives_the_playlist() {
        let playlist = parse_embed("x", &page(3)).unwrap();
        assert_eq!(playlist.name, "0to8 Promo");
        assert_eq!(playlist.owner.as_deref(), Some("YungFLUiD"));
        assert_eq!(playlist.cover_url.as_deref(), Some("https://image.example/large"));
        assert_eq!(playlist.tracks.len(), 3, "the episode left out");
        assert_eq!(playlist.tracks[0].title, "Song 0 - Slowed");
        assert_eq!(playlist.tracks[0].artists, vec!["gunbaou", "LOSTOV"]);
        assert_eq!(playlist.tracks[0].duration_ms, Some(125_794));
        assert!(!playlist.may_be_cut);
        assert!(
            parse_embed("x", &page(99)).unwrap().may_be_cut,
            "100 listed with the episode: the most the page holds"
        );
        assert!(parse_embed("x", "<html>nothing</html>").is_err());
        let gone = "<script id=\"__NEXT_DATA__\">{\"props\":{\"pageProps\":{\"state\":{\"data\":{\"entity\":null}}}}}</script>";
        assert!(parse_embed("x", gone).is_err());
    }
}
