import React, { useState } from 'react';
import { EditorState, ModelConfig } from '../../../../shared/types';
import './EditorToolbar.css';

interface EditorToolbarProps {
  state: EditorState;
  onStateChange: (state: EditorState) => void;
  availableModels: ModelConfig[];
  isLoadingModels: boolean;
  isGenerating: boolean;
  onGenerate: (prompt: string) => Promise<boolean>;
  isInlineSuggestionsEnabled: boolean;
  onToggleInlineSuggestions: (enabled: boolean) => void;
  showPromptBar?: boolean;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  state,
  onStateChange,
  availableModels,
  isLoadingModels,
  isGenerating,
  onGenerate,
  isInlineSuggestionsEnabled,
  onToggleInlineSuggestions,
  showPromptBar = true
}) => {
  const [prompt, setPrompt] = useState('');

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const handleGenerate = async () => {
    const success = await onGenerate(prompt);
    if (success) {
      setPrompt('');
    }
  };

  return (
    <div className="EditorToolbar">
      <div className="EditorToolbar-controls">
        <select
          value={state.language}
          onChange={(e) => onStateChange({ ...state, language: e.target.value })}
          className="EditorToolbar-select"
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
          className="EditorToolbar-select"
        >
          <option value="vs-dark">Dark Theme</option>
          <option value="vs-light">Light Theme</option>
        </select>

        <select
          value={state.selectedModel}
          onChange={(e) => onStateChange({ ...state, selectedModel: e.target.value })}
          className="EditorToolbar-select"
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
          onClick={() => onToggleInlineSuggestions(!isInlineSuggestionsEnabled)}
          className={`EditorToolbar-toggle-btn ${isInlineSuggestionsEnabled ? 'active' : ''}`}
          title="Toggle inline suggestions (Ctrl/Cmd + Tab to accept)"
        >
          🤖
        </button>
      </div>
      
      {showPromptBar ? (
        <div className="EditorToolbar-ai">
          <input
            type="text"
            placeholder="Ask AI to generate code... (Ctrl/Cmd + Enter to generate)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyPress={handleKeyPress}
            className="EditorToolbar-prompt"
            disabled={isGenerating}
          />
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
            className="EditorToolbar-generate-btn"
          >
            {isGenerating ? 'Generating...' : 'Generate'}
          </button>
        </div>
      ) : null}
    </div>
  );
}; 
