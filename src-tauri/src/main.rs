// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::env;
use std::fs;
use std::io::Write;
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
const PROVIDER_ENV_FILE: &str = "providers.env";
const PROVIDER_ENV_KEYS: [&str; 4] = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "OLLAMA_URL",
];

fn should_skip_entry(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".idea"
            | ".vscode"
            | "node_modules"
            | "target"
            | "dist"
            | ".next"
            | ".cache"
    )
}

#[cfg(windows)]
fn apply_no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn apply_no_window(_cmd: &mut Command) {}

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
        if should_skip_entry(&name) {
            continue;
        }
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
        if should_skip_entry(&name) {
            continue;
        }
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

fn is_probably_text_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if matches!(name.as_str(), "readme" | "license" | "dockerfile" | "makefile") {
        return true;
    }
    let ext = path
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "md"
            | "txt"
            | "json"
            | "js"
            | "jsx"
            | "ts"
            | "tsx"
            | "mjs"
            | "cjs"
            | "py"
            | "rs"
            | "go"
            | "java"
            | "cs"
            | "toml"
            | "yaml"
            | "yml"
            | "ini"
            | "conf"
            | "xml"
            | "css"
            | "scss"
            | "html"
            | "sql"
            | "sh"
            | "ps1"
    )
}

fn read_text_snippet(path: &Path, max_chars: usize) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.contains(&0) {
        return None;
    }
    let mut text = String::from_utf8_lossy(&bytes).replace('\r', "");
    if text.len() > max_chars {
        text.truncate(max_chars);
        text.push_str("\n... [truncated]");
    }
    Some(text)
}

fn build_repo_snapshot(root: &Path, max_files: usize, max_chars_per_file: usize) -> String {
    let mut files: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let preferred = [
        "README.md",
        "ARCHITECTURE.md",
        "package.json",
        "tsconfig.json",
        "vite.config.ts",
        "frontend/package.json",
        "backend/package.json",
        "backend/server.ts",
        "src-tauri/tauri.conf.json",
        "src-tauri/Cargo.toml",
    ];

    for rel in preferred {
        let p = root.join(rel);
        if p.is_file() {
            let key = p.to_string_lossy().to_string();
            if seen.insert(key) {
                files.push(p);
            }
        }
    }

    let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::new();
    queue.push_back((root.to_path_buf(), 0));
    for seed in ["src", "frontend/src", "backend/src", "src-tauri/src"] {
        let p = root.join(seed);
        if p.is_dir() {
            queue.push_back((p, 0));
        }
    }

    while let Some((dir, depth)) = queue.pop_front() {
        if files.len() >= max_files || depth > 3 {
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in entries.flatten().take(120) {
            if files.len() >= max_files {
                break;
            }
            let p = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || should_skip_entry(&name) {
                continue;
            }
            if p.is_dir() {
                queue.push_back((p, depth + 1));
                continue;
            }
            if !is_probably_text_file(&p) {
                continue;
            }
            let key = p.to_string_lossy().to_string();
            if seen.insert(key) {
                files.push(p);
            }
        }
    }

    let mut out = String::new();
    out.push_str("Workspace snapshot (real files):\n");
    out.push_str(&format!("Root: {}\n", root.to_string_lossy()));
    out.push_str("Files sampled:\n");
    for p in &files {
        let rel = p.strip_prefix(root).unwrap_or(p);
        out.push_str(&format!("- {}\n", rel.to_string_lossy()));
    }

    out.push_str("\nFile snippets:\n");
    for p in files {
        let rel = p.strip_prefix(root).unwrap_or(&p);
        if let Some(snippet) = read_text_snippet(&p, max_chars_per_file) {
            out.push_str(&format!("\n--- {} ---\n{}\n", rel.to_string_lossy(), snippet));
        }
    }
    out
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
    let mut cmd = Command::new("git");
    cmd.args([
            "-C",
            root.to_string_lossy().as_ref(),
            "branch",
            "--show-current",
        ]);
    apply_no_window(&mut cmd);
    let output = cmd
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() { None } else { Some(branch) }
}

#[tauri::command]
fn read_repo_snapshot(path: String) -> Result<String, String> {
    let root = resolve_workspace_path(&path)?;
    Ok(build_repo_snapshot(root.as_path(), 18, 1200))
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

fn parse_env_value(raw: &str) -> String {
    let value = raw.trim().to_string();
    if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
        return value[1..value.len() - 1].to_string();
    }
    if value.starts_with('\'') && value.ends_with('\'') && value.len() >= 2 {
        return value[1..value.len() - 1].to_string();
    }
    value
}

fn load_provider_env_vars(app: &tauri::AppHandle) -> Vec<(String, String)> {
    let config_dir = match app.path().app_config_dir() {
        Ok(path) => path,
        Err(_) => return Vec::new(),
    };
    let env_file = config_dir.join(PROVIDER_ENV_FILE);
    let content = match fs::read_to_string(&env_file) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut pairs: Vec<(String, String)> = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.splitn(2, '=');
        let key = parts.next().unwrap_or("").trim().to_string();
        let value = parse_env_value(parts.next().unwrap_or(""));
        if key.is_empty() || value.is_empty() {
            continue;
        }
        if PROVIDER_ENV_KEYS.iter().any(|allowed| allowed == &key) {
            pairs.push((key, value));
        }
    }
    pairs
}

#[tauri::command]
fn get_provider_config_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config_dir_error: {}", e))?;
    Ok(dir.join(PROVIDER_ENV_FILE).to_string_lossy().to_string())
}

#[tauri::command]
fn list_local_models() -> Result<Vec<String>, String> {
    let ollama_bin = resolve_ollama_bin().unwrap_or_else(|| PathBuf::from("ollama"));
    let mut cmd = Command::new(ollama_bin);
    cmd.args(["list"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_no_window(&mut cmd);
    let output = cmd
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
    let mut cmd = Command::new(ollama_bin);
    cmd.args(["run", &selected])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_no_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed_to_run_ollama: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("failed_to_write_prompt: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("failed_to_read_ollama_output: {}", e))?;

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
    let provider_env = load_provider_env_vars(app);
    cmd.arg(&entry)
        .current_dir(&backend_dir)
        .env("NODE_ENV", "production")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    for (key, value) in provider_env {
        cmd.env(key, value);
    }
    apply_no_window(&mut cmd);

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
            read_repo_snapshot,
            list_local_models,
            generate_with_ollama,
            get_provider_config_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                stop_embedded_backend(app);
            }
        });
} 
