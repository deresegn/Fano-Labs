import { useState } from 'react';

export const useEditorState = () => {
  const [isInlineSuggestionsEnabled, setIsInlineSuggestionsEnabled] = useState(false);

  return {
    isInlineSuggestionsEnabled,
    setIsInlineSuggestionsEnabled
  };
}; 