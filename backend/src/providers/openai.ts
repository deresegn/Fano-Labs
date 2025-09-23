export async function listModels(): Promise<string[]> {
  return ['gpt-4o-mini', 'gpt-4.1-mini'];
}

export async function generate(_opts: { model: string; prompt: string; stream?: boolean }) {
  throw new Error('OpenAI provider not implemented yet');
}
