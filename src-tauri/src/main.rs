// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Serialize)]
struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<FileNode>,
}

fn read_tree(path: &Path, depth: usize) -> Vec<FileNode> {
    if depth > 4 {
        return Vec::new();
    }

    let entries = match fs::read_dir(path) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut nodes = Vec::new();
    for entry in entries.flatten().take(200) {
        let entry_path = entry.path();
        let name = entry
            .file_name()
            .to_string_lossy()
            .to_string();
        let is_dir = entry_path.is_dir();
        let children = if is_dir { read_tree(&entry_path, depth + 1) } else { Vec::new() };

        nodes.push(FileNode {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }

    nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    nodes
}

fn read_shallow(path: &Path) -> Result<Vec<FileNode>, String> {
    let entries = fs::read_dir(path).map_err(|e| format!("read_dir_failed: {}", e))?;
    let mut nodes = Vec::new();
    for entry in entries.flatten().take(400) {
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry_path.is_dir();
        nodes.push(FileNode {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            children: Vec::new(),
        });
    }
    nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(nodes)
}

#[tauri::command]
fn open_folder_dialog() -> Option<String> {
    let default_dir = std::env::var("USERPROFILE")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "C:\\Users".to_string());

    rfd::FileDialog::new()
        .set_directory(default_dir)
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn list_directory_tree(path: String) -> Result<Vec<FileNode>, String> {
    let root = Path::new(&path);
    if !root.exists() || !root.is_dir() {
        return Err("Invalid folder path".to_string());
    }
    Ok(read_tree(root, 0))
}

#[tauri::command]
fn list_directory_flat(path: String) -> Result<Vec<FileNode>, String> {
    let root = Path::new(&path);
    if !root.exists() || !root.is_dir() {
        return Err("Invalid folder path".to_string());
    }
    read_shallow(root)
}

#[tauri::command]
fn get_git_branch(path: String) -> Option<String> {
    let output = Command::new("git")
        .args(["-C", &path, "branch", "--show-current"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() { None } else { Some(branch) }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            greet,
            open_folder_dialog,
            list_directory_tree,
            list_directory_flat,
            get_git_branch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
} 
