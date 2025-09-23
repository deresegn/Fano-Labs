import { Router } from 'express';
import axios from 'axios';
import { GenerateRequest, GenerateResponse, ModelConfig } from '../../shared/types';

const router = Router();

const OLLAMA_URL = 'http://localhost:11434/api/generate';

// Available models configuration
const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: 'codellama:7b-code',
    name: 'CodeLlama 7B',
    description: 'Fast and efficient code generation',
    temperature: 0.1,
    maxTokens: 1000
  },
  {
    id: 'phind-codellama:34b-v2',
    name: 'Phind CodeLlama 34B',
    description: 'High-quality code generation with better reasoning',
    temperature: 0.1,
    maxTokens: 2000
  },
  {
    id: 'codellama:13b-code',
    name: 'CodeLlama 13B',
    description: 'Balanced performance and quality',
    temperature: 0.1,
    maxTokens: 1500
  }
];

// Get available models
router.get('/models', (req, res) => {
  res.json({ models: AVAILABLE_MODELS });
});

router.post('/', async (req, res) => {
  try {
    const { prompt, language = 'javascript', context = '', model = 'codellama:7b-code' }: GenerateRequest = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Find the selected model configuration
    const modelConfig = AVAILABLE_MODELS.find(m => m.id === model) || AVAILABLE_MODELS[0];

    const fullPrompt = `You are a helpful coding assistant. Generate ${language} code based on the following request:

${prompt}

${context ? `Context: ${context}` : ''}

Please provide only the code without explanations:`;

    const response = await axios.post(OLLAMA_URL, {
      model: modelConfig.id,
      prompt: fullPrompt,
      stream: false,
      options: {
        temperature: modelConfig.temperature || 0.1,
        top_p: 0.9,
        max_tokens: modelConfig.maxTokens || 1000
      }
    });

    const generatedCode = response.data.response?.trim() || '';

    const result: GenerateResponse = {
      code: generatedCode,
      explanation: `Code generated successfully using ${modelConfig.name}`
    };

    res.json(result);
  } catch (error) {
    console.error('Error generating code:', error);
    res.status(500).json({ 
      error: 'Failed to generate code',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Refactor endpoint
router.post('/refactor', async (req, res) => {
  try {
    const { code, language = 'javascript', model = 'codellama:7b-code' }: { code: string; language?: string; model?: string } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    // Find the selected model configuration
    const modelConfig = AVAILABLE_MODELS.find(m => m.id === model) || AVAILABLE_MODELS[0];

    const refactorPrompt = `You are a code refactoring expert. Please refactor the following ${language} code to make it cleaner, more readable, and follow best practices. Maintain the same functionality but improve the code quality:

${code}

Please provide only the refactored code without explanations:`;

    const response = await axios.post(OLLAMA_URL, {
      model: modelConfig.id,
      prompt: refactorPrompt,
      stream: false,
      options: {
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: modelConfig.maxTokens || 2000
      }
    });

    const refactoredCode = response.data.response?.trim() || '';

    const result: GenerateResponse = {
      code: refactoredCode,
      explanation: `Code refactored successfully using ${modelConfig.name}`
    };

    res.json(result);
  } catch (error) {
    console.error('Error refactoring code:', error);
    res.status(500).json({ 
      error: 'Failed to refactor code',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as generateRoutes };
