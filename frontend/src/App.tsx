import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { EditorState } from '../../shared/types';
import { BackendConnection } from './features/backend/BackendConnection';
import { EditorFeature } from './features/editor/EditorFeature';
import {
  AIProvider,
  ProviderStatus,
  getAvailableModelsForProvider,
  getProviderStatus,
  getProviders,
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

const providerEnvLabel = (provider: AIProvider) => {
  if (provider === 'openai') return 'OPENAI_API_KEY';
  if (provider === 'anthropic') return 'ANTHROPIC_API_KEY';
  if (provider === 'gemini') return 'GEMINI_API_KEY';
  return 'local';
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

function App() {
  const [editorState, setEditorState] = useState<EditorState>({
    code: '// Welcome to FANO-LABS AI Code Editor\n// Open a project and start building.\n\nfunction hello() {\n  console.log("Hello, World!");\n}',
    language: 'javascript',
    theme: 'vs-dark',
    selectedModel: 'qwen2.5-coder:0.5b'
  });

  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
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
  ]);
  const [providerStatusList, setProviderStatusList] = useState<ProviderStatus[]>([]);
  const [isProviderPanelOpen, setIsProviderPanelOpen] = useState<boolean>(false);
  const [providerTesting, setProviderTesting] = useState<Record<string, boolean>>({});
  const [providerTestResult, setProviderTestResult] = useState<Record<string, string>>({});
  const [agentMode, setAgentMode] = useState<'chat' | 'repo_analyst' | 'code_editor'>('chat');

  const [rightPaneWidth, setRightPaneWidth] = useState<number>(LEFT_PANE_WIDTH);
  const [isRightPaneOpen, setIsRightPaneOpen] = useState<boolean>(true);
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);
  const [isChatInEditor, setIsChatInEditor] = useState<boolean>(false);
  const [isThreadMenuOpen, setIsThreadMenuOpen] = useState<boolean>(false);

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

  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const threadMenuRef = useRef<HTMLDivElement | null>(null);
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
        setRecentProjects(parsed.filter((p) => typeof p === 'string').slice(0, MAX_RECENT_PROJECTS));
      }
    } catch {
      // ignore malformed local storage
    }
  }, []);

  const refreshProviders = async () => {
    const [providers, status] = await Promise.all([getProviders(), getProviderStatus()]);
    setProviderOptions(providers);
    setProviderStatusList(status);
    const active = providers.find((p) => p.enabled);
    if (active && !providers.some((p) => p.id === selectedProvider && p.enabled)) {
      setSelectedProvider(active.id);
    }
  };

  useEffect(() => {
    refreshProviders();
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
        if (!options.some((m) => m.id === editorState.selectedModel)) {
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
  }, [selectedProvider]);

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
      if (!isThreadMenuOpen) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (threadMenuRef.current && !threadMenuRef.current.contains(target)) {
        setIsThreadMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isThreadMenuOpen]);

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

  const loadWorkspace = async (path: string) => {
    let resolvedPath = path;
    if (isTauri()) {
      try {
        const normalized = await invoke<string>('normalize_workspace_path', { path });
        if (normalized && typeof normalized === 'string') {
          resolvedPath = normalized;
        }
      } catch {
        // preserve original value so we can still show error below
      }
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

    if (!isTauri()) {
      try {
        const picker = (window as any).showDirectoryPicker;
        if (typeof picker === 'function') {
          const dirHandle = await picker({ mode: 'read' });
          if (dirHandle?.name) {
            // Browser directory handles don't expose absolute paths.
            // Use a virtual workspace label for dev-mode preview.
            await loadWorkspace(`C:\\Users\\deresegn\\${dirHandle.name}`);
          }
          return;
        }
      } catch {
        // user cancelled or picker unavailable
      }
      window.alert('Use the desktop app build to pick folders with full filesystem paths.');
      return;
    }
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

    if (wantsRepoAnalysis && workspacePath && isTauri()) {
      setIsAnalyzingWorkspace(true);
      try {
        repoSnapshot = await invoke<string>('read_repo_snapshot', { path: workspacePath });
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
    } catch (err: any) {
      const detail = String(err?.message || err || 'unknown error');
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

  const renderTree = (nodes: FileNode[]) => (
    <ul className="Tree-list">
      {nodes.map((node) => (
        <li key={node.path}>
          <button
            className={`Tree-node ${activeFilePath === node.path ? 'active' : ''}`}
            onClick={() => setActiveFilePath(node.path)}
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
                    <button type="button" onClick={() => loadWorkspace(project)}>
                      {getProjectName(project)}
                      <span>{project}</span>
                    </button>
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
      <div className="MenuBar">
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span>Go</span>
        <span>Run</span>
        <span>Terminal</span>
        <span>Help</span>
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
                  No files found or folder access unavailable.
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
                <EditorFeature state={editorState} onStateChange={setEditorState} showPromptBar={false} />
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
              <div className="ChatControlsRow">
                <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value as AIProvider)}>
                  {providerOptions.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.enabled}>
                      {p.id.toUpperCase()}{p.enabled ? '' : ' (no key)'}
                    </option>
                  ))}
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
              {isProviderPanelOpen ? (
                <div className="ProviderPanel">
                  <div className="ProviderPanelHeader">
                    <strong>Provider Status</strong>
                    <button type="button" onClick={refreshProviders}>
                      Refresh
                    </button>
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
                    Keys are backend-only. Add to <code>backend/.env</code>, then restart backend/app.
                  </div>
                </div>
              ) : null}
              <div className="ChatComposerRow">
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
                <button
                  type="button"
                  onClick={sendChatMessage}
                  disabled={!chatInput.trim() || isGenerating}
                >
                  Send
                </button>
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
