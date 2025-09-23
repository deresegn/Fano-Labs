import { useState } from 'react';
import { EditorState, GenerateRequest } from '../../../../shared/types';
import { generateCode } from '../../../api';

export const useCodeGeneration = (
  state: EditorState,
  onStateChange: (state: EditorState) => void
) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async (prompt: string) => {
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
        return true; // Success
      }
    } catch (error) {
      console.error('Failed to generate code:', error);
      alert('Failed to generate code. Please check if the backend server is running.');
    } finally {
      setIsGenerating(false);
    }
    return false; // Failed
  };

  return {
    isGenerating,
    handleGenerate
  };
}; 