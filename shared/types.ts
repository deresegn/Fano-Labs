export interface GenerateRequest {
  prompt: string;
  language?: string;
  context?: string;
  model?: string;
}

export interface GenerateResponse {
  code: string;
  explanation?: string;
  error?: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  temperature?: number;
  maxTokens?: number;
}

export interface EditorState {
  code: string;
  language: string;
  theme: 'vs-dark' | 'vs-light';
  selectedModel: string;
}

export interface AICompletion {
  text: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}
