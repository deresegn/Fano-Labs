import React, { useState, useRef, useEffect } from 'react';
import MonacoEditor from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { EditorState, GenerateRequest, ModelConfig } from '../../../shared/types';
import { generateCode, getAvailableModels } from '../../api';
import { useEditorState } from './hooks/useEditorState';
import { useModelSelection } from './hooks/useModelSelection';
import { useCodeGeneration } from './hooks/useCodeGeneration';
import { EditorToolbar } from './components/EditorToolbar';
import { EditorContainer } from './components/EditorContainer';
import InlineSuggestions from '../suggestions/InlineSuggestions';
import './EditorFeature.css';

// Ensure Monaco workers resolve correctly in Tauri/Vite environments
// @ts-ignore
self.MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  }
};

interface EditorFeatureProps {
  state: EditorState;
  onStateChange: (state: EditorState) => void;
  showPromptBar?: boolean;
}

export const EditorFeature: React.FC<EditorFeatureProps> = ({ 
  state, 
  onStateChange,
  showPromptBar = true
}) => {
  const editorRef = useRef<any>(null);
  
  // Custom hooks for feature separation
  const { isGenerating, handleGenerate } = useCodeGeneration(state, onStateChange);
  const { availableModels, isLoadingModels } = useModelSelection();
  const { isInlineSuggestionsEnabled, setIsInlineSuggestionsEnabled } = useEditorState();

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

  return (
    <div className="EditorFeature">
      <EditorToolbar
        state={state}
        onStateChange={onStateChange}
        availableModels={availableModels}
        isLoadingModels={isLoadingModels}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
        isInlineSuggestionsEnabled={isInlineSuggestionsEnabled}
        onToggleInlineSuggestions={setIsInlineSuggestionsEnabled}
        showPromptBar={showPromptBar}
      />
      
      <EditorContainer>
        <MonacoEditor
          height="100%"
          language={state.language}
          theme={state.theme}
          value={state.code}
          onChange={handleCodeChange}
          onMount={handleEditorDidMount}
          loading=""
          keepCurrentModel
          path={`inmemory://model.${state.language || 'js'}`}
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
      </EditorContainer>
    </div>
  );
}; 
