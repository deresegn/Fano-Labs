import { useState, useEffect } from 'react';
import { ModelConfig } from '../../../../shared/types';
import { getAvailableModels } from '../../../api';

export const useModelSelection = () => {
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const models = await getAvailableModels();
        setAvailableModels(models);
      } catch (error) {
        console.error('Failed to load models:', error);
        // Set default models if API fails
        setAvailableModels([
          {
            id: 'codellama:7b-code',
            name: 'CodeLlama 7B',
            description: 'Fast and efficient code generation'
          }
        ]);
      } finally {
        setIsLoadingModels(false);
      }
    };

    loadModels();
  }, []);

  return {
    availableModels,
    isLoadingModels
  };
}; 