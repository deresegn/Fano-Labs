import { useEffect, useRef } from 'react';
import { GenerateRequest } from '../../../shared/types';
import { generateCode } from '../../api';

interface InlineSuggestionsProps {
  editor: any;
  currentCode: string;
  currentLanguage: string;
  selectedModel: string;
  isEnabled: boolean;
}

const InlineSuggestions: React.FC<InlineSuggestionsProps> = ({
  editor, currentCode, currentLanguage, selectedModel, isEnabled
}) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSuggestionRef = useRef<string>('');
  const suggestionTextRef = useRef<string>('');
  const suggestionRangeRef = useRef<any>(null);

  useEffect(() => {
    if (!editor || !isEnabled) {
      clearInlineSuggestions();
      return;
    }

    const handleCursorChange = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(generateInlineSuggestion, 1000);
    };

    const handleContentChange = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(generateInlineSuggestion, 2000);
    };

    editor.onDidChangeCursorPosition(handleCursorChange);
    editor.onDidChangeModelContent(handleContentChange);

    return () => {
      editor.offDidChangeCursorPosition?.(handleCursorChange);
      editor.offDidChangeModelContent?.(handleContentChange);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [editor, isEnabled, currentCode, currentLanguage, selectedModel]);

  const generateInlineSuggestion = async () => {
    if (!editor || !isEnabled) return;
    const position = editor.getPosition();
    const lineContent = editor.getModel().getLineContent(position.lineNumber);
    const wordBeforeCursor = lineContent.substring(0, position.column - 1).split(/\s+/).pop() || '';
    if (wordBeforeCursor.length < 3) return;

    try {
      const request: GenerateRequest = {
        prompt: `Complete this ${currentLanguage} code: ${wordBeforeCursor}`,
        language: currentLanguage,
        context: currentCode,
        model: selectedModel
      };
      const response = await generateCode(request);
      if (response.code && response.code !== lastSuggestionRef.current) {
        lastSuggestionRef.current = response.code;
        showInlineSuggestion(response.code, position);
      }
    } catch (error) {
      console.error('Failed to generate inline suggestion:', error);
    }
  };

  const showInlineSuggestion = (suggestion: string, position: any) => {
    if (!editor) return;
    clearInlineSuggestions();
    const range = {
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: position.lineNumber,
      endColumn: position.column
    };
    suggestionTextRef.current = suggestion;
    suggestionRangeRef.current = range;
    editor.deltaDecorations([], [{
      range,
      options: {
        after: {
          content: suggestion,
          inlineClassName: 'inline-suggestion-ghost',
          color: '#888888',
          fontStyle: 'italic'
        }
      }
    }]);
  };

  const clearInlineSuggestions = () => {
    if (!editor) return;
    editor.deltaDecorations([], []);
    suggestionTextRef.current = '';
    suggestionRangeRef.current = null;
  };

  const acceptSuggestion = () => {
    if (!editor || !suggestionTextRef.current) return;
    const suggestion = suggestionTextRef.current;
    const range = suggestionRangeRef.current || editor.getPosition();
    editor.executeEdits('inline-suggestion', [{
      range: {
        startLineNumber: range.startLineNumber,
        startColumn: range.startColumn,
        endLineNumber: range.endLineNumber,
        endColumn: range.endColumn
      },
      text: suggestion
    }]);
    clearInlineSuggestions();
  };

  useEffect(() => {
    if (editor) {
      (editor as any).acceptInlineSuggestion = acceptSuggestion;
    }
  });

  return null;
};

export default InlineSuggestions;