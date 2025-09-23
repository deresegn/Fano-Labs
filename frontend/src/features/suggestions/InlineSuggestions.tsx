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
  editor,
  currentCode,
  currentLanguage,
  selectedModel,
  isEnabled
}) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSuggestionRef = useRef<string>('');

  useEffect(() => {
    if (!editor || !isEnabled) {
      clearInlineSuggestions();
      return;
    }

    const handleCursorChange = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        generateInlineSuggestion();
      }, 1000);
    };

    const handleContentChange = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        generateInlineSuggestion();
      }, 2000);
    };

    editor.onDidChangeCursorPosition(handleCursorChange);
    editor.onDidChangeModelContent(handleContentChange);

    return () => {
      editor.offDidChangeCursorPosition(handleCursorChange);
      editor.offDidChangeModelContent(handleContentChange);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
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

    const range = {
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: position.lineNumber,
      endColumn: position.column
    };

    const decoration = editor.deltaDecorations([], [{
      range,
      options: {
        after: {
          content: suggestion,
          color: '#888888',
          fontStyle: 'italic'
        }
      }
    }]);

    // Store decoration ID for later removal
    (editor as any).inlineSuggestionDecoration = decoration;
  };

  const clearInlineSuggestions = () => {
    if (!editor) return;

    if ((editor as any).inlineSuggestionDecoration) {
      editor.deltaDecorations((editor as any).inlineSuggestionDecoration, []);
      (editor as any).inlineSuggestionDecoration = null;
    }
  };

  const acceptSuggestion = () => {
    if (!editor || !(editor as any).inlineSuggestionDecoration) return;

    const decorations = editor.getModel().getDecorationsInRange((editor as any).inlineSuggestionDecoration[0]);
    if (decorations.length > 0) {
      const decoration = decorations[0];
      const suggestion = decoration.options.after?.content || '';
      
      if (suggestion) {
        const position = editor.getPosition();
        editor.executeEdits('inline-suggestion', [{
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column
          },
          text: suggestion
        }]);
      }
    }

    clearInlineSuggestions();
  };

  // Expose acceptInlineSuggestion method on editor instance
  useEffect(() => {
    if (editor) {
      (editor as any).acceptInlineSuggestion = acceptSuggestion;
    }
  }, [editor]);

  return null; // This component doesn't render anything directly
};

export default InlineSuggestions; 