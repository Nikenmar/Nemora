//! The music folders as the 1.x view reads them: each root with every folder below it that holds
//! songs, and the songs of each folder counted with its subfolders, as 1.1.9 did.

use std::collections::BTreeMap;

use nemora_core::db::Db;
use nemora_core::library;
use serde_json::{Value, json};

use crate::view::view_id;

pub struct Node {
    pub path: String,
    pub children: BTreeMap<String, Node>,
    /// View ids of the songs in this folder and below.
    pub songs: Vec<String>,
}

impl Node {
    fn new(path: String) -> Self {
        Self { path, children: BTreeMap::new(), songs: Vec::new() }
    }
}

fn separator(path: &str) -> char {
    if path.contains('\\') { '\\' } else { '/' }
}

/// One tree per music folder.
pub fn trees(db: &Db) -> nemora_core::Result<Vec<Node>> {
    let roots: Vec<String> =
        nemora_core::settings::music_folders(db)?.into_iter().map(|f| f.path.to_string_lossy().into_owned()).collect();
    let mut trees: Vec<Node> = roots.iter().map(|r| Node::new(r.clone())).collect();
    for file in library::files(db)? {
        let Some(index) = roots.iter().position(|r| {
            file.path.len() > r.len() && file.path.starts_with(r.as_str()) && {
                let next = file.path[r.len()..].chars().next();
                next == Some('\\') || next == Some('/')
            }
        }) else {
            continue;
        };
        let id = view_id(&file.song_id, file.variant_id, file.is_primary);
        let root = &mut trees[index];
        root.songs.push(id.clone());
        let sep = separator(&file.path);
        let rest = &file.path[roots[index].len() + 1..];
        let mut parts: Vec<&str> = rest.split(sep).collect();
        parts.pop(); // the file name
        let mut node = root;
        let mut path = roots[index].clone();
        for part in parts {
            path.push(sep);
            path.push_str(part);
            node = node.children.entry(part.to_owned()).or_insert_with(|| Node::new(path.clone()));
            node.songs.push(id.clone());
        }
    }
    Ok(trees)
}

const EPOCH: &str = "1970-01-01T00:00:00.000Z";

fn stats() -> Value {
    json!({ "lastModifiedDate": EPOCH, "lastChangedDate": EPOCH, "fileCreatedDate": EPOCH, "lastParsedDate": EPOCH })
}

/// 1.x `FolderStructure`.
pub fn structure(node: &Node) -> Value {
    json!({
        "path": node.path,
        "stats": stats(),
        "subFolders": node.children.values().map(structure).collect::<Vec<_>>(),
        "noOfSongs": node.songs.len(),
    })
}

/// 1.x `MusicFolder`: the structure with its songs and whether it is blacklisted.
pub fn music_folder(node: &Node, blacklisted: &[String]) -> Value {
    json!({
        "path": node.path,
        "stats": stats(),
        "subFolders": node.children.values().map(|c| music_folder(c, blacklisted)).collect::<Vec<_>>(),
        "noOfSongs": node.songs.len(),
        "songIds": node.songs,
        "isBlacklisted": blacklisted.iter().any(|b| node.path == *b || node.path.starts_with(&format!("{b}{}", separator(b)))),
    })
}

/// The nodes whose path is asked for, wherever they are in the trees.
pub fn select<'a>(nodes: impl Iterator<Item = &'a Node>, wanted: &[String], out: &mut Vec<&'a Node>) {
    for node in nodes {
        if wanted.contains(&node.path) {
            out.push(node);
        } else {
            select(node.children.values(), wanted, out);
        }
    }
}
