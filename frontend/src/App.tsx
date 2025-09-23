import React, { useState } from 'react';
import { EditorState } from '../../shared/types';
import { BackendConnection } from './features/backend/BackendConnection';
import { EditorFeature } from './features/editor/EditorFeature';
import ChatPanel from './components/ChatPanel';
import './App.css';

function App() {
  const [editorState, setEditorState] = useState<EditorState>({
    code: '// Welcome to FANO-LABS AI Code Editor\n// Start coding or ask AI for help!\n\nfunction hello() {\n  console.log("Hello, World!");\n}',
    language: 'javascript',
    theme: 'vs-dark',
    selectedModel: 'codellama:7b-code'
  });

  const [isChatOpen, setIsChatOpen] = useState(false);

  return (
    <div className="App">
      <header className="App-header">
        <h1>🚀 FANO-LABS</h1>
        <p>AI-Powered Code Editor</p>
      </header>
      
      <BackendConnection>
        <main className="App-main">
          <EditorFeature 
            state={editorState} 
            onStateChange={setEditorState} 
          />
        </main>
        <ChatPanel
          isOpen={isChatOpen}
          onToggle={() => setIsChatOpen(!isChatOpen)}
          currentCode={editorState.code}
          currentLanguage={editorState.language}
          selectedModel={editorState.selectedModel}
        />
      </BackendConnection>
    </div>
  );
}

export default App;
