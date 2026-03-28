// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

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

struct BackendState(Mutex<Option<Child>>);

fn normalize_input_path(input: &str) -> String {
    input
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .replace('/', "\\")
}

fn resolve_workspace_path(path: &str) -> Result<PathBuf, String> {
    let normalized = normalize_input_path(path);
    let as_path = PathBuf::from(&normalized);
    if as_path.exists() && as_path.is_dir() {
        return Ok(as_path);
    }

    // Helpful fallback for paths saved from browser/dev mode like C:\Users\<user>\<project>.
    let project_name = as_path
        .file_name()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_default();
    if project_name.is_empty() {
        return Err("Invalid folder path".to_string());
    }

    if let Ok(user_profile) = env::var("USERPROFILE") {
        let candidates = vec![
            PathBuf::from(&user_profile).join("GitProjects").join(&project_name),
            PathBuf::from(&user_profile).join("Documents").join(&project_name),
            PathBuf::from(&user_profile).join("Desktop").join(&project_name),
        ];

        for candidate in candidates {
            if candidate.exists() && candidate.is_dir() {
                return Ok(candidate);
            }
        }
    }

    Err("Invalid folder path".to_string())
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
fn normalize_workspace_path(path: String) -> Result<String, String> {
    let resolved = resolve_workspace_path(&path)?;
    Ok(resolved.to_string_lossy().to_string())
}

#[tauri::command]
fn list_directory_tree(path: String) -> Result<Vec<FileNode>, String> {
    let root = resolve_workspace_path(&path)?;
    Ok(read_tree(root.as_path(), 0))
}

#[tauri::command]
fn list_directory_flat(path: String) -> Result<Vec<FileNode>, String> {
    let root = resolve_workspace_path(&path)?;
    read_shallow(root.as_path())
}

#[tauri::command]
fn get_git_branch(path: String) -> Option<String> {
    let root = resolve_workspace_path(&path).ok()?;
    let output = Command::new("git")
        .args([
            "-C",
            root.to_string_lossy().as_ref(),
            "branch",
            "--show-current",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() { None } else { Some(branch) }
}

fn resolve_node_bin() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(program_files) = env::var("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("nodejs").join("node.exe"));
    }
    if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(program_files_x86).join("nodejs").join("node.exe"));
    }
    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("nodejs")
                .join("node.exe"),
        );
    }

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn resolve_ollama_bin() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("Ollama")
                .join("ollama.exe"),
        );
    }
    if let Ok(program_files) = env::var("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("Ollama").join("ollama.exe"));
    }
    if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(program_files_x86).join("Ollama").join("ollama.exe"));
    }

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

#[tauri::command]
fn list_local_models() -> Result<Vec<String>, String> {
    let ollama_bin = resolve_ollama_bin().unwrap_or_else(|| PathBuf::from("ollama"));
    let output = Command::new(ollama_bin)
        .args(["list"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("failed_to_run_ollama: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ollama_list_failed: {}", err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut models: Vec<String> = Vec::new();
    for line in stdout.lines().skip(1) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(name) = trimmed.split_whitespace().next() {
            if !name.is_empty() {
                models.push(name.to_string());
            }
        }
    }
    Ok(models)
}

#[tauri::command]
fn generate_with_ollama(prompt: String, model: Option<String>) -> Result<String, String> {
    let selected = model
        .unwrap_or_else(|| "qwen2.5-coder:0.5b".to_string())
        .trim()
        .to_string();
    if selected.is_empty() {
        return Err("invalid_model".to_string());
    }

    let ollama_bin = resolve_ollama_bin().unwrap_or_else(|| PathBuf::from("ollama"));
    let output = Command::new(ollama_bin)
        .args(["run", &selected, &prompt])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("failed_to_run_ollama: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ollama_generate_failed: {}", err));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn start_embedded_backend(app: &tauri::AppHandle) {
    let resource_dir = match app.path().resource_dir() {
        Ok(path) => path,
        Err(err) => {
            eprintln!("backend autostart: unable to resolve resource dir: {}", err);
            return;
        }
    };

    let backend_dir = resource_dir.join("backend");
    let entry = backend_dir.join("dist").join("src").join("index.js");
    if !entry.exists() {
        eprintln!("backend autostart: entry not found at {}", entry.display());
        return;
    }

    let node_bin = resolve_node_bin().unwrap_or_else(|| PathBuf::from("node"));
    let mut cmd = Command::new(node_bin);
    cmd.arg(&entry)
        .current_dir(&backend_dir)
        .env("NODE_ENV", "production")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    match cmd.spawn() {
        Ok(child) => {
            if let Ok(mut slot) = app.state::<BackendState>().0.lock() {
                *slot = Some(child);
            }
        }
        Err(err) => {
            eprintln!("backend autostart: failed to spawn node process: {}", err);
        }
    }
}

fn stop_embedded_backend(app: &tauri::AppHandle) {
    if let Ok(mut slot) = app.state::<BackendState>().0.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(BackendState(Mutex::new(None)));
            if !cfg!(debug_assertions) {
                start_embedded_backend(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            open_folder_dialog,
            normalize_workspace_path,
            list_directory_tree,
            list_directory_flat,
            get_git_branch,
            list_local_models,
            generate_with_ollama
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                stop_embedded_backend(app);
            }
        });
} 
