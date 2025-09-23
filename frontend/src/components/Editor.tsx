import React, { useState, useRef, useEffect } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { EditorState, GenerateRequest, ModelConfig } from '../../../shared/types';
import { generateCode, getAvailableModels } from '../api';
import InlineSuggestions from './InlineSuggestions';
import './Editor.css';

interface EditorProps {
  state: EditorState;
  onStateChange: (state: EditorState) => void;
}

const Editor: React.FC<EditorProps> = ({ state, onStateChange }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [isInlineSuggestionsEnabled, setIsInlineSuggestionsEnabled] = useState(false);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const models = await getAvailableModels();
        setAvailableModels(models);
      } catch (error) {
        console.error('Failed to load models:', error);
      } finally {
        setIsLoadingModels(false);
      }
    };

    loadModels();
  }, []);

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
    
    // Add keyboard shortcut for accepting inline suggestions
    editor.addCommand(2048 | 2, () => { // Ctrl/Cmd + Tab
      if (editor.acceptInlineSuggestion) {
        editor.acceptInlineSuggestion();
      }
    });
  };

  const handleCodeChange = (value: string | undefined) => {
    onStateChange({
      ...state,
      code: value || ''
    });
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    try {
      const request: GenerateRequest = {
        prompt: prompt,
        language: state.language,
        context: state.code,
        model: state.selectedModel
      };

      const response = await generateCode(request);
      
      if (response.code) {
        onStateChange({
          ...state,
          code: response.code
        });
        setPrompt('');
      }
    } catch (error) {
      console.error('Failed to generate code:', error);
      alert('Failed to generate code. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div className="Editor">
      <div className="Editor-toolbar">
        <div className="Editor-controls">
          <select
            value={state.language}
            onChange={(e) => onStateChange({ ...state, language: e.target.value })}
            className="Editor-select"
          >
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
            <option value="csharp">C#</option>
            <option value="go">Go</option>
            <option value="rust">Rust</option>
          </select>
          
          <select
            value={state.theme}
            onChange={(e) => onStateChange({ ...state, theme: e.target.value as 'vs-dark' | 'vs-light' })}
            className="Editor-select"
          >
            <option value="vs-dark">Dark Theme</option>
            <option value="vs-light">Light Theme</option>
          </select>

          <select
            value={state.selectedModel}
            onChange={(e) => onStateChange({ ...state, selectedModel: e.target.value })}
            className="Editor-select"
            disabled={isLoadingModels}
          >
            {isLoadingModels ? (
              <option>Loading models...</option>
            ) : (
              availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))
            )}
          </select>

          <button
            onClick={() => setIsInlineSuggestionsEnabled(!isInlineSuggestionsEnabled)}
            className={`Editor-toggle-btn ${isInlineSuggestionsEnabled ? 'active' : ''}`}
            title="Toggle inline suggestions (Ctrl/Cmd + Tab to accept)"
          >
            🤖
          </button>
        </div>
        
        <div className="Editor-ai">
          <input
            type="text"
            placeholder="Ask AI to generate code... (Ctrl/Cmd + Enter to generate)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyPress={handleKeyPress}
            className="Editor-prompt"
            disabled={isGenerating}
          />
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
            className="Editor-generate-btn"
          >
            {isGenerating ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </div>
      
      <div className="Editor-container">
        <MonacoEditor
          height="100%"
          language={state.language}
          theme={state.theme}
          value={state.code}
          onChange={handleCodeChange}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: true },
            fontSize: 14,
            wordWrap: 'on',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            roundedSelection: false,
            readOnly: false,
            cursorStyle: 'line',
            contextmenu: true,
            mouseWheelZoom: true,
            quickSuggestions: true,
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: 'on',
            tabCompletion: 'on',
            wordBasedSuggestions: 'allDocuments'
          }}
        />
        <InlineSuggestions
          editor={editorRef.current}
          currentCode={state.code}
          currentLanguage={state.language}
          selectedModel={state.selectedModel}
          isEnabled={isInlineSuggestionsEnabled}
        />
      </div>
    </div>
  );
};

export default Editor;
