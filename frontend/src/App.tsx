import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { EditorState } from '../../shared/types';
import { BackendConnection } from './features/backend/BackendConnection';
import { EditorFeature } from './features/editor/EditorFeature';
import {
  AIProvider,
  ProviderStatus,
  getBackendBase,
  getAvailableModelsForProvider,
  getCloudBackendBase,
  getProviderStatus,
  setBackendBaseOverride,
  getWebWorkspaceDirs,
  getWebWorkspaceFile,
  getWebWorkspaceInfo,
  getWebWorkspaceSnapshot,
  getWebWorkspaceTree,
  streamGenerate,
  testProvider
} from './api';
import './App.css';

type FileNode = {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[];
};

type ChatMessage = {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
};

type ChatThread = {
  id: string;
  title: string;
  messages: ChatMessage[];
};

const RECENT_PROJECTS_KEY = 'fano.recentProjects';
const MAX_RECENT_PROJECTS = 5;
const LEFT_PANE_WIDTH = 260;
const WEB_RECENT_PREFIX = 'web:';
const LOCAL_WEB_PREFIX = 'local:';
const WEB_LOCAL_IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache', 'target']);
const WEB_FS_DB = 'fano-web-fs';
const WEB_FS_STORE = 'dir-handles';

const isTauri = () =>
  typeof window !== 'undefined' &&
  (typeof (window as any).__TAURI__ !== 'undefined' ||
    typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' ||
    String(window.location.protocol || '').startsWith('tauri'));

const getProjectName = (path: string) => {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || 'Untitled Project';
};

const encodeWebRecent = (base: string, label: string) => `${WEB_RECENT_PREFIX}${base}|${label}`;

const decodeWebRecent = (value: string): { base: string; label: string } | null => {
  if (!String(value || '').startsWith(WEB_RECENT_PREFIX)) return null;
  const raw = String(value).slice(WEB_RECENT_PREFIX.length);
  const sep = raw.indexOf('|');
  if (sep === -1) return { base: raw || '.', label: raw || 'Web Workspace' };
  const base = raw.slice(0, sep) || '.';
  const label = raw.slice(sep + 1) || base;
  return { base, label };
};

const encodeLocalRecent = (label: string) => `${LOCAL_WEB_PREFIX}${label}`;

const decodeLocalRecent = (value: string): { label: string } | null => {
  if (!String(value || '').startsWith(LOCAL_WEB_PREFIX)) return null;
  const label = String(value).slice(LOCAL_WEB_PREFIX.length).trim();
  return label ? { label } : null;
};

const supportsFileSystemHandles = () =>
  typeof window !== 'undefined' &&
  typeof indexedDB !== 'undefined' &&
  typeof (window as any).showDirectoryPicker === 'function';

const openFsDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(WEB_FS_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(WEB_FS_STORE)) {
          db.createObjectStore(WEB_FS_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexeddb_open_failed'));
    } catch (e) {
      reject(e);
    }
  });

const saveLocalDirHandle = async (label: string, handle: any): Promise<void> => {
  if (!supportsFileSystemHandles()) return;
  const db = await openFsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WEB_FS_STORE, 'readwrite');
    tx.objectStore(WEB_FS_STORE).put(handle, label);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('indexeddb_put_failed'));
  });
  db.close();
};

const readLocalDirHandle = async (label: string): Promise<any | null> => {
  if (!supportsFileSystemHandles()) return null;
  const db = await openFsDb();
  const result = await new Promise<any | null>((resolve, reject) => {
    const tx = db.transaction(WEB_FS_STORE, 'readonly');
    const req = tx.objectStore(WEB_FS_STORE).get(label);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error || new Error('indexeddb_get_failed'));
  });
  db.close();
  return result;
};

const ensureLocalDirPermission = async (handle: any): Promise<boolean> => {
  if (!handle) return false;
  try {
    const query = await handle.queryPermission?.({ mode: 'read' });
    if (query === 'granted') return true;
    const requested = await handle.requestPermission?.({ mode: 'read' });
    return requested === 'granted';
  } catch {
    return false;
  }
};

const providerEnvLabel = (provider: AIProvider) => {
  if (provider === 'openai') return 'OPENAI_API_KEY';
  if (provider === 'anthropic') return 'ANTHROPIC_API_KEY';
  if (provider === 'gemini') return 'GEMINI_API_KEY';
  return 'local';
};

const preferredProviderModel: Record<AIProvider, string> = {
  ollama: 'qwen2.5-coder:0.5b',
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini: 'gemini-2.5-flash',
};

const detectBillingError = (text: string): string | null => {
  const v = String(text || '').toLowerCase();
  if (!v) return null;
  if (v.includes('insufficient_quota') || v.includes('exceeded your current quota')) {
    return 'OpenAI API credits/quota are exhausted. Add API billing credits in OpenAI Platform.';
  }
  if (v.includes('credit balance is too low') || (v.includes('anthropic') && v.includes('too low'))) {
    return 'Anthropic API credits are too low. Add credits in Anthropic Console billing.';
  }
  if (v.includes('429') && v.includes('openai')) {
    return 'OpenAI returned 429. This is usually quota/rate-limit; check API billing and limits.';
  }
  if (v.includes('rate limit') && v.includes('anthropic')) {
    return 'Anthropic rate limit hit. Check plan limits or reduce request frequency.';
  }
  return null;
};

const flattenTree = (nodes: FileNode[], prefix = '', depth = 0, limit = 120): string[] => {
  if (depth > 3 || limit <= 0) return [];
  const lines: string[] = [];
  for (const node of nodes) {
    if (lines.length >= limit) break;
    const marker = node.is_dir ? '[D]' : '[F]';
    lines.push(`${prefix}${marker} ${node.name}`);
    if (node.is_dir && node.children.length > 0) {
      const remaining = limit - lines.length;
      const nested = flattenTree(node.children, `${prefix}  `, depth + 1, remaining);
      lines.push(...nested);
    }
  }
  return lines;
};

const languageFromPath = (filePath: string): string => {
  const normalized = String(filePath || '').toLowerCase();
  if (normalized.endsWith('.ts') || normalized.endsWith('.tsx')) return 'typescript';
  if (normalized.endsWith('.js') || normalized.endsWith('.jsx')) return 'javascript';
  if (normalized.endsWith('.json')) return 'json';
  if (normalized.endsWith('.css')) return 'css';
  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) return 'html';
  if (normalized.endsWith('.md')) return 'markdown';
  if (normalized.endsWith('.py')) return 'python';
  if (normalized.endsWith('.rs')) return 'rust';
  if (normalized.endsWith('.go')) return 'go';
  if (normalized.endsWith('.java')) return 'java';
  if (normalized.endsWith('.yml') || normalized.endsWith('.yaml')) return 'yaml';
  if (normalized.endsWith('.sh')) return 'shell';
  return 'javascript';
};

function App() {
  const [editorState, setEditorState] = useState<EditorState>({
    code: '// Welcome to FANO-LABS AI Code Editor\n// Open a project and start building.\n\nfunction hello() {\n  console.log("Hello, World!");\n}',
    language: 'javascript',
    theme: 'vs-dark',
    selectedModel: 'qwen2.5-coder:0.5b'
  });

  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [webWorkspaceBase, setWebWorkspaceBase] = useState<string>('.');
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [isLoadingTree, setIsLoadingTree] = useState<boolean>(false);
  const [treeError, setTreeError] = useState<string>('');
  const [activeFilePath, setActiveFilePath] = useState<string>('');
  const [branchName, setBranchName] = useState<string>('unknown');
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('ollama');
  const [providerOptions, setProviderOptions] = useState<Array<{ id: AIProvider; enabled: boolean }>>([
    { id: 'ollama', enabled: true },
    { id: 'openai', enabled: false },
    { id: 'anthropic', enabled: false },
    { id: 'gemini', enabled: false },
  ]);
  const [providerStatusList, setProviderStatusList] = useState<ProviderStatus[]>([]);
  const [isProviderPanelOpen, setIsProviderPanelOpen] = useState<boolean>(false);
  const [providerTesting, setProviderTesting] = useState<Record<string, boolean>>({});
  const [providerTestResult, setProviderTestResult] = useState<Record<string, string>>({});
  const [providerConfigPath, setProviderConfigPath] = useState<string>('');
  const [providerAlert, setProviderAlert] = useState<string>('');
  const [backendBaseUrl, setBackendBaseUrl] = useState<string>(getBackendBase());
  const [agentMode, setAgentMode] = useState<'chat' | 'repo_analyst' | 'code_editor'>('chat');

  const [rightPaneWidth, setRightPaneWidth] = useState<number>(LEFT_PANE_WIDTH);
  const [isRightPaneOpen, setIsRightPaneOpen] = useState<boolean>(true);
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);
  const [isChatInEditor, setIsChatInEditor] = useState<boolean>(false);
  const [isThreadMenuOpen, setIsThreadMenuOpen] = useState<boolean>(false);
  const [openTopMenu, setOpenTopMenu] = useState<string | null>(null);

  const [threads, setThreads] = useState<ChatThread[]>([
    {
      id: 'thread-1',
      title: 'New Chat',
      messages: [
        {
          id: 'm-1',
          type: 'assistant',
          content: 'Ready when you are. Ask me to edit a file and I will stream changes here.',
          timestamp: new Date()
        }
      ]
    }
  ]);
  const [activeThreadId, setActiveThreadId] = useState<string>('thread-1');
  const [chatInput, setChatInput] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isAnalyzingWorkspace, setIsAnalyzingWorkspace] = useState<boolean>(false);
  const isWebMode = !isTauri();

  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const threadMenuRef = useRef<HTMLDivElement | null>(null);
  const topMenuRef = useRef<HTMLDivElement | null>(null);
  const webLocalFileHandlesRef = useRef<Map<string, any>>(new Map());
  const resizeState = useRef<{ resizing: boolean; startX: number; startWidth: number }>({
    resizing: false,
    startX: 0,
    startWidth: LEFT_PANE_WIDTH
  });

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? threads[0],
    [threads, activeThreadId]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .filter((p) => typeof p === 'string')
          .map((p) => String(p))
          .filter((p) => p.trim().length > 0)
          .filter((p) => !isWebMode || p.startsWith(WEB_RECENT_PREFIX) || p.startsWith(LOCAL_WEB_PREFIX))
          .slice(0, MAX_RECENT_PROJECTS);
        setRecentProjects(cleaned);
      }
    } catch {
      // ignore malformed local storage
    }
  }, []);

  const refreshProviders = async () => {
    const order: AIProvider[] = ['ollama', 'openai', 'anthropic', 'gemini'];
    try {
      const statusList = await getProviderStatus();
      if (!Array.isArray(statusList) || statusList.length === 0) return;
      setProviderStatusList(statusList);
      const nextOptions = order.map((id) => {
        const found = statusList.find((s) => s.id === id);
        return {
          id,
          enabled: id === 'ollama' ? true : Boolean(found?.enabled || found?.configured),
        };
      });
      setProviderOptions(nextOptions);
      const active = nextOptions.find((p) => p.enabled);
      if (active && !nextOptions.some((p) => p.id === selectedProvider && p.enabled)) {
        setSelectedProvider(active.id);
      }
    } catch {
      // Keep last known provider state on transient failures.
    }
  };

  useEffect(() => {
    refreshProviders();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshProviders();
    }, 12000);
    const onFocus = () => {
      refreshProviders();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<string>('get_provider_config_path')
      .then((p) => setProviderConfigPath(String(p || '')))
      .catch(() => setProviderConfigPath(''));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const loadModels = async () => {
      attempts += 1;
      const unique = new Map<string, { id: string; name: string }>();

      if (isTauri() && selectedProvider === 'ollama') {
        try {
          const native = await invoke<string[]>('list_local_models');
          if (Array.isArray(native)) {
            native
              .map((n) => String(n || '').trim())
              .filter(Boolean)
              .forEach((id) => unique.set(id, { id, name: id }));
          }
        } catch {
          // ignore and continue to API fallback
        }
      }

      try {
        const models = await getAvailableModelsForProvider(selectedProvider);
        models.forEach((m) => {
          const id = String(m.id || '').trim();
          if (!id) return;
          unique.set(id, { id, name: m.name || id });
        });
      } catch {
        // ignore
      }

      const options = Array.from(unique.values());
      if (!cancelled && options.length > 0) {
        setModelOptions(options);
        const preferred = preferredProviderModel[selectedProvider];
        const hasCurrent = options.some((m) => m.id === editorState.selectedModel);
        const hasPreferred = options.some((m) => m.id === preferred);
        if (hasPreferred && editorState.selectedModel !== preferred) {
          setEditorState((prev) => ({ ...prev, selectedModel: preferred }));
        } else if (!hasCurrent) {
          setEditorState((prev) => ({ ...prev, selectedModel: options[0].id }));
        }
      }

      if (!cancelled && options.length <= 1 && attempts < 6) {
        window.setTimeout(loadModels, 2500);
      }
    };

    loadModels();
    return () => {
      cancelled = true;
    };
  }, [selectedProvider, backendBaseUrl]);

  useEffect(() => {
    const status = providerStatusList.find((p) => p.id === selectedProvider);
    if (status && selectedProvider !== 'ollama' && !status.configured) {
      setProviderAlert(`Missing ${providerEnvLabel(selectedProvider)} for ${selectedProvider.toUpperCase()}.`);
      return;
    }
    setProviderAlert('');
  }, [selectedProvider, providerStatusList]);

  useEffect(() => {
    chatMessagesRef.current?.scrollTo({
      top: chatMessagesRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [threads]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeState.current.resizing) return;
      const delta = resizeState.current.startX - e.clientX;
      const width = Math.max(220, Math.min(420, resizeState.current.startWidth + delta));
      setRightPaneWidth(width);
    };
    const onUp = () => {
      resizeState.current.resizing = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (isThreadMenuOpen && threadMenuRef.current && !threadMenuRef.current.contains(target)) {
        setIsThreadMenuOpen(false);
      }
      if (openTopMenu && topMenuRef.current && !topMenuRef.current.contains(target)) {
        setOpenTopMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsThreadMenuOpen(false);
        setOpenTopMenu(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [isThreadMenuOpen, openTopMenu]);

  const persistRecentProjects = (projects: string[]) => {
    setRecentProjects(projects);
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(projects.slice(0, MAX_RECENT_PROJECTS)));
  };

  const appendRecentProject = (path: string) => {
    const next = [path, ...recentProjects.filter((p) => p !== path)].slice(0, MAX_RECENT_PROJECTS);
    persistRecentProjects(next);
  };

  const removeRecentProject = (path: string) => {
    persistRecentProjects(recentProjects.filter((p) => p !== path));
  };

  const buildWebLocalTree = async (
    dirHandle: any,
    basePath = '',
    depth = 0,
    maxDepth = 5,
    counter = { count: 0 }
  ): Promise<FileNode[]> => {
    if (!dirHandle || depth > maxDepth || counter.count > 2000) return [];
    const children: FileNode[] = [];
    const entries: Array<{ name: string; handle: any }> = [];
    for await (const [name, handle] of dirHandle.entries()) {
      entries.push({ name: String(name), handle });
    }
    entries.sort((a, b) => {
      const ad = a.handle?.kind === 'directory';
      const bd = b.handle?.kind === 'directory';
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (counter.count > 2000) break;
      const name = entry.name;
      const handle = entry.handle;
      if (name.startsWith('.') && name !== '.env.example') continue;
      const rel = basePath ? `${basePath}/${name}` : name;
      if (handle.kind === 'directory') {
        if (WEB_LOCAL_IGNORED_DIRS.has(name)) continue;
        counter.count += 1;
        const nested = await buildWebLocalTree(handle, rel, depth + 1, maxDepth, counter);
        children.push({ name, path: rel, is_dir: true, children: nested });
      } else if (handle.kind === 'file') {
        counter.count += 1;
        webLocalFileHandlesRef.current.set(rel, handle);
        children.push({ name, path: rel, is_dir: false, children: [] });
      }
    }
    return children;
  };

  const loadWebLocalWorkspace = async (dirHandle: any) => {
    const label = String(dirHandle?.name || 'local-workspace');
    webLocalFileHandlesRef.current.clear();
    setIsLoadingTree(true);
    setTreeError('');
    try {
      await saveLocalDirHandle(label, dirHandle).catch(() => undefined);
      const nodes = await buildWebLocalTree(dirHandle);
      setWorkspacePath(`Local: ${label}`);
      setWebWorkspaceBase(`local:${label}`);
      setFileTree(nodes);
      setActiveFilePath(`local:${label}`);
      setBranchName('web-local');
      appendRecentProject(encodeLocalRecent(label));
    } catch (e: any) {
      setWorkspacePath(`Local: ${label}`);
      setWebWorkspaceBase(`local:${label}`);
      setFileTree([]);
      setActiveFilePath(`local:${label}`);
      setTreeError(String(e?.message || e || 'Failed to load local browser workspace'));
      setBranchName('web-local');
    } finally {
      setIsLoadingTree(false);
    }
  };

  const loadWorkspace = async (path: string) => {
    if (!isTauri()) {
      if (String(path || '').startsWith(LOCAL_WEB_PREFIX)) {
        const decoded = decodeLocalRecent(path);
        const label = decoded?.label || 'local-workspace';
        try {
          const handle = await readLocalDirHandle(label);
          const ok = await ensureLocalDirPermission(handle);
          if (handle && ok) {
            await loadWebLocalWorkspace(handle);
            return;
          }
        } catch {
          // fallback to hint below
        }
        setWorkspacePath(`Local: ${label}`);
        setWebWorkspaceBase(`local:${label}`);
        setActiveFilePath(`local:${label}`);
        setFileTree([]);
        setTreeError('Local folder access expired after refresh. Re-open folder and grant access again.');
        setBranchName('web-local');
        return;
      }
      setIsLoadingTree(true);
      setTreeError('');
      setFileTree([]);
      try {
        let target = String(path || '.').trim() || '.';
        if (
          target.toLowerCase() === 'current' ||
          target.toLowerCase().startsWith('web workspace') ||
          target.includes('\\') ||
          target.includes(':')
        ) {
          target = '.';
        }
        let info = await getWebWorkspaceInfo(target);
        let base = info.base || target;
        if (!base || base.includes('\\') || base.includes(':')) {
          info = await getWebWorkspaceInfo('.');
          base = info.base || '.';
        }
        const nodes = await getWebWorkspaceTree(4, base);
        const label = info.rootLabel || base || info.root || 'Web Workspace';
        setWorkspacePath(label);
        appendRecentProject(encodeWebRecent(base, label));
        setWebWorkspaceBase(base);
        setFileTree(nodes);
        setActiveFilePath(base);
        setBranchName(info.branch || 'web');
      } catch (e: any) {
        setWorkspacePath(path || 'Web Workspace');
        setActiveFilePath(path || '.');
        setFileTree([]);
        setTreeError(String(e?.message || e || 'Failed to load server workspace tree'));
        setBranchName('web');
      } finally {
        setIsLoadingTree(false);
      }
      return;
    }

    let resolvedPath = path;
    try {
      const normalized = await invoke<string>('normalize_workspace_path', { path });
      if (normalized && typeof normalized === 'string') {
        resolvedPath = normalized;
      }
    } catch {
      // preserve original value so we can still show error below
    }

    setWorkspacePath(resolvedPath);
    appendRecentProject(resolvedPath);
    setActiveFilePath(resolvedPath);
    setIsLoadingTree(true);
    setFileTree([]);
    setTreeError('');

    try {
      const nodes = await invoke<FileNode[]>('list_directory_tree', { path: resolvedPath });
      if (Array.isArray(nodes) && nodes.length > 0) {
        setFileTree(nodes);
      } else {
        const flat = await invoke<FileNode[]>('list_directory_flat', { path: resolvedPath });
        setFileTree(Array.isArray(flat) ? flat : []);
      }
    } catch (e: any) {
      setFileTree([]);
      const msg = String(e?.message || e || 'Failed to load directory tree');
      setTreeError(msg);
      if (msg.toLowerCase().includes('invalid folder path')) {
        removeRecentProject(resolvedPath);
      }
    } finally {
      setIsLoadingTree(false);
    }

    try {
      const branch = await invoke<string | null>('get_git_branch', { path: resolvedPath });
      setBranchName(branch || 'no-git');
    } catch {
      setBranchName('local');
    }
  };

  const handleOpenFolder = async () => {
    if (isTauri()) {
      try {
        const picked = await invoke<string | null>('open_folder_dialog');
        if (picked) {
          await loadWorkspace(picked);
        }
        return;
      } catch {
        // fall through to browser fallback
      }
    }

    try {
      const picker = (window as any).showDirectoryPicker;
      if (typeof picker === 'function') {
        const dirHandle = await picker({ mode: 'read' });
        if (dirHandle?.name) {
          await loadWebLocalWorkspace(dirHandle);
        }
        return;
      }
    } catch {
      // user cancelled local picker or browser blocks it
      return;
    }

    try {
      const dirs = await getWebWorkspaceDirs('.');
      if (dirs.length > 0) {
        const options = dirs.slice(0, 20).map((d, i) => `${i + 1}. ${d.name}`).join('\n');
        const pick = window.prompt(
          `Select server folder number:\n${options}\n\nPress Cancel to open default workspace.`,
          '1'
        );
        if (pick === null) return;
        const idx = Number(String(pick || '').trim());
        if (Number.isInteger(idx) && idx >= 1 && idx <= dirs.length) {
          await loadWorkspace(dirs[idx - 1].path);
          return;
        }
      }
    } catch {
      // fallback below
    }
    await loadWorkspace('.');
  };

  const addNewThread = () => {
    const nextId = `thread-${Date.now()}`;
    const nextThread: ChatThread = {
      id: nextId,
      title: 'New Chat',
      messages: []
    };
    setThreads((prev) => [nextThread, ...prev]);
    setActiveThreadId(nextId);
  };

  const closeActiveThread = () => {
    setThreads((prev) => {
      const filtered = prev.filter((t) => t.id !== activeThreadId);
      if (filtered.length === 0) {
        const nextId = `thread-${Date.now()}`;
        setActiveThreadId(nextId);
        return [{ id: nextId, title: 'New Chat', messages: [] }];
      }
      setActiveThreadId(filtered[0].id);
      return filtered;
    });
  };

  const closeOtherThreads = () => {
    setThreads((prev) => {
      const active = prev.find((t) => t.id === activeThreadId);
      if (!active) return prev.slice(0, 1);
      return [active];
    });
  };

  const closeAllThreads = () => {
    const nextId = `thread-${Date.now()}`;
    setThreads([{ id: nextId, title: 'New Chat', messages: [] }]);
    setActiveThreadId(nextId);
  };

  const renameThreadFromPrompt = (threadId: string, prompt: string) => {
    const title = prompt.trim().slice(0, 40) || 'New Chat';
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId && t.title === 'New Chat' ? { ...t, title } : t))
    );
  };

  const updateActiveThreadMessages = (updater: (messages: ChatMessage[]) => ChatMessage[]) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === activeThreadId ? { ...t, messages: updater(t.messages) } : t))
    );
  };

  const sendChatMessage = async () => {
    const prompt = chatInput.trim();
    if (!prompt || !activeThread || isGenerating) return;

    setChatInput('');
    setIsGenerating(true);
    renameThreadFromPrompt(activeThread.id, prompt);

    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      type: 'user',
      content: prompt,
      timestamp: new Date()
    };
    const assistantId = `a-${Date.now() + 1}`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      type: 'assistant',
      content: '',
      timestamp: new Date()
    };

    updateActiveThreadMessages((messages) => [...messages, userMessage, assistantMessage]);

    const treeLines = flattenTree(fileTree, '', 0, 120);
    const wantsRepoAnalysis = /\b(scan|analy[sz]e|architecture|codebase|repo|repository)\b/i.test(
      prompt
    );
    let repoSnapshot = '';

    if (wantsRepoAnalysis && workspacePath) {
      setIsAnalyzingWorkspace(true);
      try {
        if (isTauri()) {
          repoSnapshot = await invoke<string>('read_repo_snapshot', { path: workspacePath });
        } else {
          repoSnapshot = await getWebWorkspaceSnapshot(12000, webWorkspaceBase || '.');
        }
        if (repoSnapshot.length > 10000) {
          repoSnapshot = `${repoSnapshot.slice(0, 10000)}\n... [snapshot truncated]`;
        }
      } catch {
        repoSnapshot = '';
      } finally {
        setIsAnalyzingWorkspace(false);
      }
    }

    const architectureFormat = wantsRepoAnalysis
      ? [
          '',
          'When the user asks to scan/explain architecture, your response MUST follow exactly these sections in order:',
          '1) Observed (with file refs)',
          'Use bullets. Include only concrete evidence from provided tree/snapshot. Add file refs like `frontend/src/App.tsx`.',
          '2) Inferred',
          'List reasonable inferences separately from observed facts. If unsure, say `Unknown (not in provided files)`.',
          '3) Open Questions',
          'List missing info needed for higher confidence.',
          '4) Next files to inspect',
          'Give 5-10 specific paths to inspect next.',
          'Output only these 4 sections and nothing else.',
          'Do not repeat or discuss these instructions in the answer.',
          'Do not output generic git setup instructions.',
          'Do not claim repository is private/inaccessible when context is provided.',
          'Do not invent framework requirements like `main`/`render` unless explicitly present in files.'
        ].join('\n')
      : '';

    const agentModeInstruction =
      agentMode === 'repo_analyst'
        ? 'Agent mode: Repo Analyst. Focus on architecture, module boundaries, data flow, and confidence levels.'
        : agentMode === 'code_editor'
          ? 'Agent mode: Code Editor. Propose concrete edits, include patch strategy, and suggest next file changes.'
          : 'Agent mode: Chat. Keep responses concise and actionable.';

    const workspaceContext = [
      'You are FANO-LABS local coding assistant.',
      agentModeInstruction,
      'You only have access to the workspace context provided below.',
      'Never say the repository is private/inaccessible if a file tree is provided.',
      'If user asks for architecture, summarize concrete modules, entrypoints, data flow, and dependencies from provided context.',
      'If details are missing, ask for a specific file to open next.',
      `Workspace root: ${workspacePath || 'unknown'}`,
      `Active file: ${activeFilePath || 'none'}`,
      'Visible workspace tree:',
      treeLines.length > 0 ? treeLines.join('\n') : '(tree unavailable)',
      repoSnapshot ? `\nRepository snapshot:\n${repoSnapshot}` : '',
      architectureFormat
    ].join('\n');

    try {
      await streamGenerate(
        {
          prompt: `${workspaceContext}\n\nUser request:\n${prompt}`,
          model: editorState.selectedModel,
          language: editorState.language,
          provider: selectedProvider
        },
        (delta) => {
          updateActiveThreadMessages((messages) =>
            messages.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
          );
        }
      );
      setProviderAlert('');
    } catch (err: any) {
      const detail = String(err?.message || err || 'unknown error');
      const billingHint = detectBillingError(detail);
      if (billingHint) setProviderAlert(billingHint);
      updateActiveThreadMessages((messages) =>
        messages.map((m) =>
          m.id === assistantId
            ? { ...m, content: `Sorry, I hit an error while generating this response.\n\n${detail}` }
            : m
        )
      );
    } finally {
      setIsGenerating(false);
      setIsAnalyzingWorkspace(false);
    }
  };

  const runProviderTest = async (provider: AIProvider) => {
    setProviderTesting((prev) => ({ ...prev, [provider]: true }));
    setProviderTestResult((prev) => ({ ...prev, [provider]: '' }));
    try {
      const result = await testProvider(provider);
      setProviderTestResult((prev) => ({ ...prev, [provider]: result.detail }));
      const billingHint = detectBillingError(result.detail);
      if (billingHint) setProviderAlert(billingHint);
      else if (result.ok && provider === selectedProvider) setProviderAlert('');
      if (result.status) {
        setProviderStatusList((prev) =>
          prev.map((p) => (p.id === provider ? { ...p, ...result.status } : p))
        );
      }
    } catch (err: any) {
      setProviderTestResult((prev) => ({
        ...prev,
        [provider]: String(err?.message || err || 'Provider test failed.')
      }));
    } finally {
      setProviderTesting((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const applyBackendTarget = async (target: 'local' | 'cloud') => {
    if (target === 'cloud') {
      setBackendBaseOverride(getCloudBackendBase());
    } else {
      setBackendBaseOverride(null);
    }
    const next = getBackendBase();
    setBackendBaseUrl(next);
    await refreshProviders();
  };

  const runMenuAction = async (action: () => void | Promise<void>) => {
    setOpenTopMenu(null);
    await action();
  };

  const goHome = () => {
    setWorkspacePath(null);
    setActiveFilePath('');
    setFileTree([]);
    setTreeError('');
    setBranchName('unknown');
  };

  const reloadCurrentWorkspace = async () => {
    if (!workspacePath) return;
    if (isTauri()) {
      await loadWorkspace(workspacePath);
      return;
    }
    const base = webWorkspaceBase && !webWorkspaceBase.startsWith('local:') ? webWorkspaceBase : '.';
    await loadWorkspace(base);
  };

  const focusComposer = () => {
    const el = document.querySelector('.ComposerShell textarea') as HTMLTextAreaElement | null;
    if (el) el.focus();
  };

  const focusTree = () => {
    const el = document.querySelector('.Tree-node') as HTMLButtonElement | null;
    if (el) el.focus();
  };

  const focusThreads = () => {
    const el = document.querySelector('.ThreadItem') as HTMLButtonElement | null;
    if (el) el.focus();
  };

  const handleTreeNodeClick = async (node: FileNode) => {
    setActiveFilePath(node.path);
    if (node.is_dir) return;
    if (!isWebMode) return;
    try {
      let content = '';
      if (webWorkspaceBase.startsWith('local:')) {
        const handle = webLocalFileHandlesRef.current.get(node.path);
        if (!handle) throw new Error('Local file handle not available. Re-open folder to refresh access.');
        const file = await handle.getFile();
        content = await file.text();
      } else {
        content = await getWebWorkspaceFile(node.path);
      }
      setEditorState((prev) => ({
        ...prev,
        code: content,
        language: languageFromPath(node.path),
      }));
    } catch (e: any) {
      setTreeError(String(e?.message || e || 'Failed to open file from server workspace'));
    }
  };

  const renderTree = (nodes: FileNode[]) => (
    <ul className="Tree-list">
      {nodes.map((node) => (
        <li key={node.path}>
          <button
            className={`Tree-node ${activeFilePath === node.path ? 'active' : ''}`}
            onClick={() => handleTreeNodeClick(node)}
            type="button"
          >
            <span className="Tree-node-icon">{node.is_dir ? '▸' : '•'}</span>
            <span className="Tree-node-name">{node.name}</span>
          </button>
          {node.is_dir && node.children.length > 0 ? renderTree(node.children) : null}
        </li>
      ))}
    </ul>
  );

  const renderChatMessages = () => (
    <div className="ChatMessages" ref={chatMessagesRef}>
      {(activeThread?.messages || []).map((message) => (
        <div key={message.id} className={`ChatBubble ${message.type}`}>
          <pre>{message.content}</pre>
        </div>
      ))}
      {isAnalyzingWorkspace ? <div className="TypingDots">Analyzing workspace...</div> : null}
      {isGenerating ? <div className="TypingDots">AI is typing...</div> : null}
    </div>
  );

  if (!workspacePath) {
    return (
      <div className="App WelcomeRoot">
        <div className="WelcomeCenter">
          <h1>FANO-LABS IDE AI Editor</h1>
          <p>Open a local folder to start coding with AI.</p>
          <div className="WelcomeActions">
            <button className="PrimaryBtn" type="button" onClick={handleOpenFolder}>
              Open Folder
            </button>
            <button className="SecondaryBtn" type="button" disabled>
              Connect GitHub (Soon)
            </button>
          </div>
          <div className="RecentProjects">
            <h3>Recent Projects</h3>
            {recentProjects.length === 0 ? (
              <p className="MutedText">No recent projects yet.</p>
            ) : (
              <ul>
                {recentProjects.map((project) => (
                  <li key={project}>
                    {(() => {
                      const decoded = decodeWebRecent(project);
                      const localDecoded = decodeLocalRecent(project);
                      const label = decoded?.label || localDecoded?.label || getProjectName(project);
                      const subtitle = decoded?.base || localDecoded?.label || project;
                      const targetPath = decoded ? decoded.base : localDecoded ? project : project;
                      return (
                        <button type="button" onClick={() => loadWorkspace(targetPath)}>
                          {label}
                          <span>{subtitle}</span>
                        </button>
                      );
                    })()}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <div className="MenuBar" ref={topMenuRef}>
        <div className="TopMenu">
          <button type="button" className="TopMenuBtn" onClick={() => setOpenTopMenu((v) => (v === 'file' ? null : 'file'))}>File</button>
          {openTopMenu === 'file' ? (
            <div className="TopMenuDropdown">
              <button type="button" onClick={() => runMenuAction(() => handleOpenFolder())}>Open Folder</button>
              <button type="button" onClick={() => runMenuAction(() => reloadCurrentWorkspace())}>Reload Workspace</button>
              <button type="button" onClick={() => runMenuAction(() => addNewThread())}>New Chat</button>
              <button type="button" onClick={() => runMenuAction(() => goHome())}>Back To Home</button>
            </div>
          ) : null}
        </div>

        <div className="TopMenu">
          <button type="button" className="TopMenuBtn" onClick={() => setOpenTopMenu((v) => (v === 'edit' ? null : 'edit'))}>Edit</button>
          {openTopMenu === 'edit' ? (
            <div className="TopMenuDropdown">
              <button type="button" onClick={() => runMenuAction(() => document.execCommand('undo'))}>Undo</button>
              <button type="button" onClick={() => runMenuAction(() => document.execCommand('redo'))}>Redo</button>
              <button type="button" onClick={() => runMenuAction(() => document.execCommand('copy'))}>Copy</button>
              <button type="button" onClick={() => runMenuAction(() => document.execCommand('paste'))}>Paste</button>
            </div>
          ) : null}
        </div>

        <div className="TopMenu">
          <button type="button" className="TopMenuBtn" onClick={() => setOpenTopMenu((v) => (v === 'view' ? null : 'view'))}>View</button>
          {openTopMenu === 'view' ? (
            <div className="TopMenuDropdown">
              <button type="button" onClick={() => runMenuAction(() => setIsRightPaneOpen((v) => !v))}>{isRightPaneOpen ? 'Hide Chat Pane' : 'Show Chat Pane'}</button>
              <button type="button" onClick={() => runMenuAction(() => setIsTerminalOpen((v) => !v))}>{isTerminalOpen ? 'Hide Terminal' : 'Show Terminal'}</button>
              <button type="button" onClick={() => runMenuAction(() => setIsProviderPanelOpen((v) => !v))}>{isProviderPanelOpen ? 'Hide Provider Status' : 'Show Provider Status'}</button>
              <button type="button" onClick={() => runMenuAction(() => setIsChatInEditor((v) => !v))}>{isChatInEditor ? 'Dock Chat In Side' : 'Open Chat In Editor'}</button>
            </div>
          ) : null}
        </div>

        <div className="TopMenu">
          <button type="button" className="TopMenuBtn" onClick={() => setOpenTopMenu((v) => (v === 'go' ? null : 'go'))}>Go</button>
          {openTopMenu === 'go' ? (
            <div className="TopMenuDropdown">
              <button type="button" onClick={() => runMenuAction(() => focusComposer())}>Focus Composer</button>
              <button type="button" onClick={() => runMenuAction(() => focusTree())}>Focus File Tree</button>
              <button type="button" onClick={() => runMenuAction(() => focusThreads())}>Focus Chat Tabs</button>
            </div>
          ) : null}
        </div>

        <div className="TopMenu">
          <button type="button" className="TopMenuBtn" onClick={() => setOpenTopMenu((v) => (v === 'run' ? null : 'run'))}>Run</button>
          {openTopMenu === 'run' ? (
            <div className="TopMenuDropdown">
              <button type="button" onClick={() => runMenuAction(() => sendChatMessage())}>Send Prompt</button>
              <button type="button" onClick={() => runMenuAction(() => runProviderTest(selectedProvider))}>Test Current Provider</button>
              <button type="button" onClick={() => runMenuAction(() => refreshProviders())}>Refresh Providers</button>
            </div>
          ) : null}
        </div>

        <div className="TopMenu">
          <button type="button" className="TopMenuBtn" onClick={() => setOpenTopMenu((v) => (v === 'terminal' ? null : 'terminal'))}>Terminal</button>
          {openTopMenu === 'terminal' ? (
            <div className="TopMenuDropdown">
              <button type="button" onClick={() => runMenuAction(() => setIsTerminalOpen((v) => !v))}>{isTerminalOpen ? 'Hide Terminal' : 'Show Terminal'}</button>
            </div>
          ) : null}
        </div>

        <div className="TopMenu">
          <button type="button" className="TopMenuBtn" onClick={() => setOpenTopMenu((v) => (v === 'help' ? null : 'help'))}>Help</button>
          {openTopMenu === 'help' ? (
            <div className="TopMenuDropdown">
              <button type="button" onClick={() => runMenuAction(() => window.open('https://app.fanolabs.dev', '_blank'))}>Open App URL</button>
              <button type="button" onClick={() => runMenuAction(() => window.open('https://api.fanolabs.dev/health', '_blank'))}>Open API Health</button>
              <button type="button" onClick={() => runMenuAction(() => setIsProviderPanelOpen(true))}>Show Provider Status</button>
            </div>
          ) : null}
        </div>
      </div>

      <BackendConnection>
        <div className="Shell">
          <aside className="LeftPane">
            <div className="PaneHeader">
              <strong>{getProjectName(workspacePath).toUpperCase()}</strong>
            </div>
            <div className="PaneContent">
              {isLoadingTree ? (
                <div className="PaneEmpty">Loading folder tree...</div>
              ) : fileTree.length > 0 ? (
                renderTree(fileTree)
              ) : (
                <div className="PaneEmpty">
                  {isWebMode ? 'Web workspace tree is empty or unavailable.' : 'No files found or folder access unavailable.'}
                  {isWebMode ? (
                    <div className="PaneNote">
                      Web mode reads files from the server workspace configured for this app.
                    </div>
                  ) : null}
                  {treeError ? <div className="PaneError">{treeError}</div> : null}
                </div>
              )}
            </div>
          </aside>

          <section className="CenterPane">
            <div className="EditorContextBar">
              <span className="FileBadge">Editing: {activeFilePath || workspacePath}</span>
              <div className="CenterActions">
                <button type="button" onClick={() => setIsTerminalOpen((v) => !v)}>
                  {isTerminalOpen ? 'Hide Terminal' : 'Show Terminal'}
                </button>
                <button type="button" onClick={() => setIsRightPaneOpen((v) => !v)}>
                  {isRightPaneOpen ? 'Hide Chat' : 'Show Chat'}
                </button>
              </div>
            </div>

            <main className="EditorHost">
              {isChatInEditor ? (
                <section className="ChatEditorHost">
                  <div className="ChatEditorHeader">
                    <strong>{activeThread?.title || 'Chat'}</strong>
                    <button type="button" onClick={() => setIsChatInEditor(false)}>
                      Back To Editor
                    </button>
                  </div>
                  {renderChatMessages()}
                </section>
              ) : (
                <EditorFeature state={editorState} onStateChange={setEditorState} showPromptBar={false} showToolbar={false} />
              )}
            </main>

            {isTerminalOpen ? (
              <section className="TerminalPane">
                <div className="TerminalTabs">
                  <span className="active">Terminal</span>
                  <span>Output</span>
                  <span>Problems</span>
                </div>
                <div className="TerminalBody">
                  <code>PS {workspacePath}&gt; </code>
                </div>
              </section>
            ) : null}

            <div className="ChatInputZone CenterComposerDock">
              <div className="AgentStatusLine">
                <span>{selectedProvider.toUpperCase()}</span>
                <span>{editorState.selectedModel}</span>
                <span>{agentMode === 'repo_analyst' ? 'Repo Analyst' : agentMode === 'code_editor' ? 'Code Editor' : 'Chat'}</span>
              </div>
              {providerAlert ? <div className="ProviderAlert">{providerAlert}</div> : null}
              {isProviderPanelOpen ? (
                <div className="ProviderPanel">
                  <div className="ProviderPanelHeader">
                    <strong>Provider Status</strong>
                    <button type="button" onClick={refreshProviders}>
                      Refresh
                    </button>
                  </div>
                  <div className="BackendTargetRow">
                    <span>Backend: <code>{backendBaseUrl}</code></span>
                    <div className="BackendTargetActions">
                      <button
                        type="button"
                        className={!backendBaseUrl.includes('api.fanolabs.dev') ? 'active' : ''}
                        onClick={() => applyBackendTarget('local')}
                      >
                        Local Desktop
                      </button>
                      <button
                        type="button"
                        className={backendBaseUrl.includes('api.fanolabs.dev') ? 'active' : ''}
                        onClick={() => applyBackendTarget('cloud')}
                      >
                        Cloud API
                      </button>
                    </div>
                  </div>
                  <div className="ProviderPanelRows">
                    {providerStatusList.map((p) => {
                      const badge = !p.configured
                        ? 'Missing Key'
                        : p.reachable === false
                          ? 'Unreachable'
                          : p.reachable === true
                            ? 'Connected'
                            : p.enabled
                              ? 'Configured'
                              : 'Unavailable';
                      return (
                        <div className="ProviderRow" key={p.id}>
                          <div className="ProviderMain">
                            <span className="ProviderName">{p.id.toUpperCase()}</span>
                            <span className={`ProviderBadge ${badge.toLowerCase().replace(/\s+/g, '-')}`}>{badge}</span>
                          </div>
                          <div className="ProviderDetail">{p.detail || `Set ${providerEnvLabel(p.id)} in backend/.env`}</div>
                          <div className="ProviderActions">
                            <button
                              type="button"
                              onClick={() => runProviderTest(p.id)}
                              disabled={Boolean(providerTesting[p.id])}
                            >
                              {providerTesting[p.id] ? 'Testing...' : 'Test'}
                            </button>
                            {providerTestResult[p.id] ? <span>{providerTestResult[p.id]}</span> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="ProviderHint">
                    Keys are backend-only. {providerConfigPath ? (
                      <>For installed app, set keys in <code>{providerConfigPath}</code>. </>
                    ) : null}
                    For dev mode, use <code>backend/.env</code>. Restart backend/app after changes.
                  </div>
                </div>
              ) : null}
              <div className="ComposerShell">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={
                    agentMode === 'repo_analyst'
                      ? 'Ask to scan architecture, trace modules, or explain data flow...'
                      : agentMode === 'code_editor'
                        ? 'Describe the code change you want and where to apply it...'
                        : 'Plan, ask, and iterate...'
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendChatMessage();
                    }
                  }}
                />
                <div className="ComposerFooter">
                  <div className="ComposerSelects">
                    <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value as AIProvider)}>
                      {providerOptions.map((p) => {
                        const status = providerStatusList.find((s) => s.id === p.id);
                        const enabled = p.id === 'ollama' ? true : Boolean(status?.enabled || status?.configured || p.enabled);
                        return (
                          <option key={p.id} value={p.id} disabled={!enabled}>
                            {p.id.toUpperCase()}{enabled ? '' : ' (no key)'}
                          </option>
                        );
                      })}
                    </select>
                    <select
                      value={editorState.selectedModel}
                      onChange={(e) =>
                        setEditorState((prev) => ({ ...prev, selectedModel: e.target.value }))
                      }
                    >
                      {modelOptions.length > 0 ? (
                        modelOptions.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                          </option>
                        ))
                      ) : (
                        <option value={editorState.selectedModel}>{editorState.selectedModel}</option>
                      )}
                    </select>
                    <select value={agentMode} onChange={(e) => setAgentMode(e.target.value as any)}>
                      <option value="chat">Chat Mode</option>
                      <option value="repo_analyst">Repo Analyst</option>
                      <option value="code_editor">Code Editor</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={sendChatMessage}
                    disabled={!chatInput.trim() || isGenerating}
                  >
                    Send
                  </button>
                </div>
              </div>
              <div className="StatusLine">
                <span>{getProjectName(workspacePath)}</span>
                <span>{branchName}</span>
                <span>FANO-LABS Tab</span>
              </div>
              <div className="ProviderPanelToggleRow">
                <button
                  type="button"
                  className="ProviderPanelToggle"
                  onClick={() => {
                    const next = !isProviderPanelOpen;
                    setIsProviderPanelOpen(next);
                    if (next) refreshProviders();
                  }}
                >
                  {isProviderPanelOpen ? 'Hide Provider Status' : 'Provider Status'}
                </button>
              </div>
            </div>
          </section>

          {isRightPaneOpen ? (
            <>
              <div
                className="RightResizer"
                onMouseDown={(e) => {
                  resizeState.current = {
                    resizing: true,
                    startX: e.clientX,
                    startWidth: rightPaneWidth
                  };
                }}
              />
              <aside className="RightPane" style={{ width: rightPaneWidth }}>
                <div className="PaneHeader RightHeader">
                  <strong>New Agent / Chats</strong>
                  <div className="RightHeaderActions">
                    <div className="ThreadMenuWrap" ref={threadMenuRef}>
                      <button type="button" onClick={() => setIsThreadMenuOpen((v) => !v)}>
                        ...
                      </button>
                      {isThreadMenuOpen ? (
                        <div className="ThreadMenu">
                          <button type="button" onClick={() => { setIsChatInEditor((v) => !v); setIsThreadMenuOpen(false); }}>
                            {isChatInEditor ? 'Dock In Side' : 'Open Tab As Editor'}
                          </button>
                          <button type="button" onClick={() => { closeActiveThread(); setIsThreadMenuOpen(false); }}>
                            Close Tab
                          </button>
                          <button type="button" onClick={() => { closeOtherThreads(); setIsThreadMenuOpen(false); }}>
                            Close Other Tabs
                          </button>
                          <button type="button" onClick={() => { closeAllThreads(); setIsThreadMenuOpen(false); }}>
                            Close All Tabs
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button type="button" onClick={() => setIsChatInEditor((v) => !v)}>
                      {isChatInEditor ? 'Dock In Side' : 'Open In Editor'}
                    </button>
                    <button type="button" onClick={addNewThread}>
                      + New Chat
                    </button>
                  </div>
                </div>
                <div className="ThreadList">
                  {threads.map((thread) => (
                    <button
                      key={thread.id}
                      type="button"
                      className={`ThreadItem ${thread.id === activeThreadId ? 'active' : ''}`}
                      onClick={() => setActiveThreadId(thread.id)}
                    >
                      {thread.title}
                    </button>
                  ))}
                </div>

                {!isChatInEditor ? renderChatMessages() : (
                  <div className="PaneEmpty">Chat is open in the editor area.</div>
                )}
              </aside>
            </>
          ) : null}
        </div>
      </BackendConnection>
    </div>
  );
}

export default App;
