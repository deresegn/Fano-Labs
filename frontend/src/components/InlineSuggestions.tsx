import { useEffect, useRef } from 'react';
import { GenerateRequest } from '../../../shared/types';
import { generateCode } from '../api';

interface InlineSuggestionsProps {
  editor: any;
  currentCode: string;
  currentLanguage: string;
  selectedModel: string;
  isEnabled: boolean;
}

const InlineSuggestions: React.FC<InlineSuggestionsProps> = ({
  editor,
  currentCode,
  currentLanguage,
  selectedModel,
  isEnabled
}) => {
  const suggestionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSuggestionRef = useRef<string>('');

  useEffect(() => {
    if (!editor || !isEnabled) return;

    const handleCursorPositionChanged = () => {
      if (suggestionTimeoutRef.current) {
        clearTimeout(suggestionTimeoutRef.current);
      }

      // Debounce suggestions to avoid too many API calls
      suggestionTimeoutRef.current = setTimeout(async () => {
        await generateInlineSuggestion();
      }, 1000);
    };

    const handleModelContentChanged = () => {
      // Clear suggestions when content changes
      clearInlineSuggestions();
    };

    // Subscribe to editor events
    editor.onDidChangeCursorPosition(handleCursorPositionChanged);
    editor.onDidChangeModelContent(handleModelContentChanged);

    return () => {
      if (suggestionTimeoutRef.current) {
        clearTimeout(suggestionTimeoutRef.current);
      }
      editor.offDidChangeCursorPosition(handleCursorPositionChanged);
      editor.offDidChangeModelContent(handleModelContentChanged);
    };
  }, [editor, isEnabled, currentCode, currentLanguage, selectedModel]);

  const generateInlineSuggestion = async () => {
    if (!editor) return;

    const position = editor.getPosition();
    const lineContent = editor.getModel().getLineContent(position.lineNumber);
    const currentWord = getCurrentWord(lineContent, position.column - 1);

    // Only suggest if we have a meaningful context
    if (currentWord.length < 2) return;

    try {
      const request: GenerateRequest = {
        prompt: `Complete this ${currentLanguage} code: ${currentWord}`,
        language: currentLanguage,
        context: currentCode,
        model: selectedModel
      };

      const response = await generateCode(request);
      
      if (response.code && response.code.trim()) {
        const suggestion = response.code.trim();
        showInlineSuggestion(suggestion, position);
      }
    } catch (error) {
      console.error('Failed to generate inline suggestion:', error);
    }
  };

  const getCurrentWord = (lineContent: string, column: number): string => {
    const beforeCursor = lineContent.substring(0, column);
    const words = beforeCursor.split(/\s+/);
    return words[words.length - 1] || '';
  };

  const showInlineSuggestion = (suggestion: string, position: any) => {
    if (!editor) return;

    // Create a decoration for the suggestion
    const range = {
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: position.lineNumber,
      endColumn: position.column
    };

    const decorationId = editor.deltaDecorations([], [{
      range,
      options: {
        after: {
          content: suggestion,
          color: '#6a9955',
          fontStyle: 'italic'
        }
      }
    }]);

    // Store the decoration ID for later removal
    lastSuggestionRef.current = decorationId;
  };

  const clearInlineSuggestions = () => {
    if (!editor || !lastSuggestionRef.current) return;
    
    editor.deltaDecorations([lastSuggestionRef.current], []);
    lastSuggestionRef.current = '';
  };

  const acceptSuggestion = () => {
    if (!editor || !lastSuggestionRef.current) return;

    // Get the suggestion text from the decoration
    const decorations = editor.getModel().getAllDecorations();
    const suggestionDecoration = decorations.find(d => d.id === lastSuggestionRef.current);
    
    if (suggestionDecoration) {
      const position = editor.getPosition();
      const suggestionText = suggestionDecoration.options.after?.content || '';
      
      // Insert the suggestion at cursor position
      editor.executeEdits('inline-suggestion', [{
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        },
        text: suggestionText
      }]);
    }

    clearInlineSuggestions();
  };

  // Expose acceptSuggestion method to parent component
  useEffect(() => {
    if (editor) {
      (editor as any).acceptInlineSuggestion = acceptSuggestion;
    }
  }, [editor]);

  return null; // This component doesn't render anything
};

export default InlineSuggestions; 