import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { EditorState } from '../../shared/types';
import { BackendConnection } from './features/backend/BackendConnection';
import { EditorFeature } from './features/editor/EditorFeature';
import { getAvailableModels, streamGenerate } from './api';
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

  const [rightPaneWidth, setRightPaneWidth] = useState<number>(380);
  const [isRightPaneOpen, setIsRightPaneOpen] = useState<boolean>(true);
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);

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

  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const resizeState = useRef<{ resizing: boolean; startX: number; startWidth: number }>({
    resizing: false,
    startX: 0,
    startWidth: 380
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

  useEffect(() => {
    const loadModels = async () => {
      const models = await getAvailableModels();
      const options = models.map((m) => ({ id: m.id, name: m.name }));
      setModelOptions(options);
      if (options.length > 0 && !options.some((m) => m.id === editorState.selectedModel)) {
        setEditorState((prev) => ({ ...prev, selectedModel: options[0].id }));
      }
    };
    loadModels();
  }, []);

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
      const width = Math.max(280, Math.min(620, resizeState.current.startWidth + delta));
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

    try {
      await streamGenerate(
        {
          prompt: `You are assisting with file: ${activeFilePath || 'unknown file'}\n\nUser request: ${prompt}`,
          model: editorState.selectedModel,
          language: editorState.language
        },
        (delta) => {
          updateActiveThreadMessages((messages) =>
            messages.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
          );
        }
      );
    } catch {
      updateActiveThreadMessages((messages) =>
        messages.map((m) =>
          m.id === assistantId
            ? { ...m, content: 'Sorry, I hit an error while generating this response.' }
            : m
        )
      );
    } finally {
      setIsGenerating(false);
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
              <EditorFeature state={editorState} onStateChange={setEditorState} />
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
                  <button type="button" onClick={addNewThread}>
                    + New Chat
                  </button>
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

                <div className="ChatMessages" ref={chatMessagesRef}>
                  {(activeThread?.messages || []).map((message) => (
                    <div key={message.id} className={`ChatBubble ${message.type}`}>
                      <pre>{message.content}</pre>
                    </div>
                  ))}
                  {isGenerating ? <div className="TypingDots">AI is typing...</div> : null}
                </div>

                <div className="ChatInputZone">
                  <div className="ChatInputRow">
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
                    <textarea
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Plan, ask, and iterate..."
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
                    <span>FANO-LABS IDE AI Editor</span>
                  </div>
                </div>
              </aside>
            </>
          ) : null}
        </div>
      </BackendConnection>
    </div>
  );
}

export default App;
