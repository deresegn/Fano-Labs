import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { execSync } from 'child_process'
import { existsSync, promises as fsp, readFileSync } from 'fs'
import path from 'path'

dotenv.config()

const PORT = Number(process.env.PORT) || 3001
type Provider = 'ollama' | 'openai' | 'anthropic' | 'gemini'
type ProviderStatus = {
  id: Provider
  enabled: boolean
  configured: boolean
  reachable: boolean | null
  detail: string
}

type WorkspaceNode = {
  name: string
  path: string
  is_dir: boolean
  children: WorkspaceNode[]
}

// Try env first, then both localhost variants
const OLLAMA_URLS = [
  process.env.OLLAMA_URL,
  process.env.OLLAMA_HOST,
  'http://127.0.0.1:11434',
  'http://localhost:11434',
].filter(Boolean) as string[]
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)

const DEFAULT_MODELS: Record<Provider, string[]> = {
  ollama: ['qwen2.5-coder:0.5b'],
  openai: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'],
  anthropic: ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
}

const WORKSPACE_MAX_DEPTH = Math.max(1, Math.min(8, Number(process.env.WEB_WORKSPACE_MAX_DEPTH || 4)))
const WORKSPACE_MAX_NODES = Math.max(200, Math.min(5000, Number(process.env.WEB_WORKSPACE_MAX_NODES || 1200)))
const WORKSPACE_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  '.next',
  '.turbo',
  '.cache',
  '.idea',
  '.vscode',
])

function detectWorkspaceRoot(): string {
  const envRoot = String(process.env.WEB_WORKSPACE_ROOT || process.env.WORKSPACE_ROOT || '').trim()
  if (envRoot) return path.resolve(envRoot)

  const cwd = process.cwd()
  if (existsSync(path.join(cwd, 'frontend')) && existsSync(path.join(cwd, 'backend'))) {
    return cwd
  }
  if (path.basename(cwd) === 'backend') {
    const parent = path.resolve(cwd, '..')
    if (existsSync(path.join(parent, 'frontend')) && existsSync(path.join(parent, 'backend'))) {
      return parent
    }
  }
  return cwd
}

const WORKSPACE_ROOT = detectWorkspaceRoot()

function detectWorkspaceLabel(absPath: string): string {
  const envLabel = String(process.env.WEB_WORKSPACE_LABEL || '').trim()
  if (envLabel) return envLabel
  try {
    const pkgPath = path.join(absPath, 'package.json')
    if (existsSync(pkgPath)) {
      const raw = readFileSync(pkgPath, 'utf8')
      const j = JSON.parse(raw)
      const name = String(j?.name || '').trim()
      if (name) return name
    }
  } catch {
    // ignore parse errors
  }
  const base = path.basename(absPath)
  if (base.toLowerCase() === 'current') {
    const parent = path.basename(path.dirname(absPath))
    if (parent) return parent
  }
  return base || 'workspace'
}

function toPosixRelative(absPath: string): string {
  const rel = path.relative(WORKSPACE_ROOT, absPath)
  return rel.split(path.sep).join('/')
}

function safeWorkspacePath(relPath: string): string {
  const input = String(relPath || '').trim().replace(/\\/g, '/')
  const absolute = path.resolve(WORKSPACE_ROOT, input || '.')
  const normalizedRoot = path.resolve(WORKSPACE_ROOT)
  const inside = absolute === normalizedRoot || absolute.startsWith(normalizedRoot + path.sep)
  if (!inside) {
    throw new Error('invalid_workspace_path')
  }
  return absolute
}

function getGitBranch(workspaceRoot: string): string | null {
  try {
    const out = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || null
  } catch {
    return null
  }
}

async function listWorkspaceTree(dirAbs: string, depth: number, counter: { count: number }): Promise<WorkspaceNode[]> {
  if (counter.count >= WORKSPACE_MAX_NODES) return []
  const entries = await fsp.readdir(dirAbs, { withFileTypes: true })
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })

  const nodes: WorkspaceNode[] = []
  for (const entry of entries) {
    if (counter.count >= WORKSPACE_MAX_NODES) break
    if (entry.name.startsWith('.') && entry.name !== '.env.example') {
      if (entry.name !== '.github') continue
    }
    if (entry.isDirectory() && WORKSPACE_IGNORED_DIRS.has(entry.name)) continue

    const abs = path.join(dirAbs, entry.name)
    const rel = toPosixRelative(abs)
    const isDir = entry.isDirectory()
    counter.count += 1
    const node: WorkspaceNode = {
      name: entry.name,
      path: rel,
      is_dir: isDir,
      children: [],
    }
    if (isDir && depth > 0) {
      try {
        node.children = await listWorkspaceTree(abs, depth - 1, counter)
      } catch {
        node.children = []
      }
    }
    nodes.push(node)
  }
  return nodes
}

function flattenTreeLines(nodes: WorkspaceNode[], prefix = '', limit = 220): string[] {
  if (limit <= 0) return []
  const lines: string[] = []
  for (const node of nodes) {
    if (lines.length >= limit) break
    lines.push(`${prefix}${node.is_dir ? '[D]' : '[F]'} ${node.path}`)
    if (node.is_dir && node.children.length > 0) {
      const nested = flattenTreeLines(node.children, `${prefix}  `, limit - lines.length)
      lines.push(...nested)
    }
  }
  return lines
}

function parseProvider(input: any): Provider {
  const v = String(input || 'ollama').toLowerCase()
  if (v === 'openai' || v === 'anthropic' || v === 'gemini') return v
  return 'ollama'
}

function isConfigured(provider: Provider): boolean {
  if (provider === 'openai') return Boolean(OPENAI_API_KEY)
  if (provider === 'anthropic') return Boolean(ANTHROPIC_API_KEY)
  if (provider === 'gemini') return Boolean(GEMINI_API_KEY)
  return true
}

function providerStatus(provider: Provider): ProviderStatus {
  if (provider === 'ollama') {
    return {
      id: 'ollama',
      enabled: true,
      configured: true,
      reachable: null,
      detail: 'Local provider. Use Ollama running on this machine.',
    }
  }

  const configured = isConfigured(provider)
  const label = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'
  return {
    id: provider,
    enabled: configured,
    configured,
    reachable: null,
    detail: configured ? 'API key detected.' : `Missing ${label} in backend environment.`,
  }
}

async function callOllama(path: string, init?: RequestInit): Promise<Response> {
  let lastErr: any
  for (const base of OLLAMA_URLS) {
    try {
      const r = await fetch(`${base}${path}`, init)
      if (!r.ok) throw new Error(`${base}${path} -> ${r.status}`)
      return r
    } catch (e) {
      lastErr = e
      console.error('[ollama]', String(e))
    }
  }
  throw lastErr ?? new Error('Could not reach Ollama on any URL')
}

async function listInstalledModels(): Promise<string[]> {
  try {
    const upstream = await callOllama('/api/tags')
    const data: any = await upstream.json()
    return Array.isArray(data?.models) ? data.models.map((m: any) => m?.name).filter(Boolean) : []
  } catch {
    return []
  }
}

function pickModel(requestedModel: string, installedModels: string[]): string | null {
  if (installedModels.includes(requestedModel)) return requestedModel
  if (installedModels.length > 0) return installedModels[0]
  return null
}

async function listOpenAIModels(): Promise<string[]> {
  if (!OPENAI_API_KEY) return []
  try {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    })
    if (!r.ok) throw new Error(`openai_models_${r.status}`)
    const j: any = await r.json()
    const ids = Array.isArray(j?.data) ? j.data.map((m: any) => String(m?.id || '')) : []
    const filtered = ids.filter((id: string) => /^gpt-/.test(id)).sort()
    return filtered.length > 0 ? filtered : DEFAULT_MODELS.openai
  } catch {
    return DEFAULT_MODELS.openai
  }
}

async function generateWithOpenAI(prompt: string, model: string): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error('openai_api_key_missing')
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`openai_generate_${r.status}: ${txt}`)
  }
  const j: any = await r.json()
  return String(j?.choices?.[0]?.message?.content || '').trim()
}

async function generateWithAnthropic(prompt: string, model: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error('anthropic_api_key_missing')
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`anthropic_generate_${r.status}: ${txt}`)
  }
  const j: any = await r.json()
  const content = Array.isArray(j?.content) ? j.content : []
  const text = content.map((c: any) => c?.text || '').join('\n')
  return String(text || '').trim()
}

async function generateWithGemini(prompt: string, model: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('gemini_api_key_missing')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`gemini_generate_${r.status}: ${txt}`)
  }
  const j: any = await r.json()
  const text =
    j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('\n') || ''
  return String(text).trim()
}

async function testProvider(provider: Provider): Promise<{ ok: boolean; detail: string }> {
  try {
    if (provider === 'ollama') {
      const upstream = await callOllama('/api/tags')
      const j: any = await upstream.json()
      const count = Array.isArray(j?.models) ? j.models.length : 0
      return { ok: true, detail: `Ollama reachable. ${count} model(s) detected.` }
    }

    if (provider === 'openai') {
      if (!OPENAI_API_KEY) return { ok: false, detail: 'Missing OPENAI_API_KEY.' }
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      })
      if (!r.ok) return { ok: false, detail: `OpenAI test failed (${r.status}).` }
      return { ok: true, detail: 'OpenAI connection is healthy.' }
    }

    if (provider === 'anthropic') {
      if (!ANTHROPIC_API_KEY) return { ok: false, detail: 'Missing ANTHROPIC_API_KEY.' }
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
      })
      if (!r.ok) return { ok: false, detail: `Anthropic test failed (${r.status}).` }
      return { ok: true, detail: 'Anthropic connection is healthy.' }
    }

    if (!GEMINI_API_KEY) return { ok: false, detail: 'Missing GEMINI_API_KEY.' }
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(GEMINI_API_KEY)}`
    )
    if (!r.ok) return { ok: false, detail: `Gemini test failed (${r.status}).` }
    return { ok: true, detail: 'Gemini connection is healthy.' }
  } catch (err: any) {
    return { ok: false, detail: String(err?.message || err || 'unknown_error') }
  }
}

const app = express()

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)
      const defaultAllowed =
        origin === 'tauri://localhost' ||
        origin === 'https://tauri.localhost' ||
        origin === 'http://tauri.localhost' ||
        origin === 'http://localhost:5173' ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('http://localhost:')
      const envAllowed = CORS_ORIGINS.includes(origin)
      if (defaultAllowed || envAllowed) return cb(null, true)
      return cb(new Error(`cors_blocked_origin:${origin}`))
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)
app.options(/.*/, cors())

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// tiny logger
app.use((req, _res, next) => { console.log(new Date().toISOString(), req.method, req.url); next() })

app.get(['/health', '/api/health', '/v1/health'], (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() })
})

app.get(['/models', '/api/models', '/v1/models'], async (_req, res) => {
  const provider = parseProvider((_req.query as any)?.provider)
  try {
    let models: string[] = []
    if (provider === 'openai') {
      models = await listOpenAIModels()
    } else if (provider === 'anthropic') {
      models = ANTHROPIC_API_KEY ? DEFAULT_MODELS.anthropic : []
    } else if (provider === 'gemini') {
      models = GEMINI_API_KEY ? DEFAULT_MODELS.gemini : []
    } else {
      const upstream = await callOllama('/api/tags')
      const data: any = await upstream.json()
      models = Array.isArray(data?.models) ? data.models.map((m: any) => m.name).filter(Boolean) : []
    }
    res.json({ models })
  } catch (err: any) {
    console.error('GET /models:', err?.message || err)
    res.json({ models: DEFAULT_MODELS[provider] || DEFAULT_MODELS.ollama })
  }
})

app.get(['/providers', '/api/providers', '/v1/providers'], (_req, res) => {
  res.json({
    providers: [
      providerStatus('ollama'),
      providerStatus('openai'),
      providerStatus('anthropic'),
      providerStatus('gemini'),
    ],
  })
})

app.get(['/providers/status', '/api/providers/status', '/v1/providers/status'], (_req, res) => {
  res.json({
    providers: [
      providerStatus('ollama'),
      providerStatus('openai'),
      providerStatus('anthropic'),
      providerStatus('gemini'),
    ],
  })
})

app.post(['/providers/test', '/api/providers/test', '/v1/providers/test'], async (req, res) => {
  const provider = parseProvider((req.body as any)?.provider)
  const result = await testProvider(provider)
  const base = providerStatus(provider)
  res.status(result.ok ? 200 : 502).json({
    provider,
    ok: result.ok,
    detail: result.detail,
    status: {
      ...base,
      reachable: result.ok,
      detail: result.detail,
    },
  })
})

app.get(['/workspace/info', '/api/workspace/info', '/v1/workspace/info'], (_req, res) => {
  const inputPath = String((_req.query as any)?.path || '.')
  const base = safeWorkspacePath(inputPath)
  const branch = getGitBranch(base)
  res.json({
    root: WORKSPACE_ROOT,
    base: toPosixRelative(base) || '.',
    rootLabel: detectWorkspaceLabel(base),
    branch,
  })
})

app.get(['/workspace/dirs', '/api/workspace/dirs', '/v1/workspace/dirs'], async (req, res) => {
  try {
    const base = safeWorkspacePath(String((req.query as any)?.path || '.'))
    const entries = await fsp.readdir(base, { withFileTypes: true })
    const dirs = entries
      .filter((e) => e.isDirectory() && !WORKSPACE_IGNORED_DIRS.has(e.name))
      .map((e) => {
        const abs = path.join(base, e.name)
        return {
          name: e.name,
          path: toPosixRelative(abs),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    res.json({
      base: toPosixRelative(base) || '.',
      dirs,
    })
  } catch (err: any) {
    res.status(400).json({ error: 'workspace_dirs_failed', detail: String(err?.message || err) })
  }
})

app.get(['/workspace/tree', '/api/workspace/tree', '/v1/workspace/tree'], async (req, res) => {
  try {
    const depthRaw = Number((req.query as any)?.depth ?? WORKSPACE_MAX_DEPTH)
    const depth = Math.max(1, Math.min(WORKSPACE_MAX_DEPTH, Number.isFinite(depthRaw) ? depthRaw : WORKSPACE_MAX_DEPTH))
    const base = safeWorkspacePath(String((req.query as any)?.path || '.'))
    const counter = { count: 0 }
    const nodes = await listWorkspaceTree(base, depth, counter)
    res.json({
      root: WORKSPACE_ROOT,
      base: toPosixRelative(base) || '.',
      depth,
      nodeCount: counter.count,
      nodes,
    })
  } catch (err: any) {
    res.status(400).json({ error: 'workspace_tree_failed', detail: String(err?.message || err) })
  }
})

app.get(['/workspace/file', '/api/workspace/file', '/v1/workspace/file'], async (req, res) => {
  try {
    const rel = String((req.query as any)?.path || '').trim()
    if (!rel) return res.status(400).json({ error: 'workspace_file_path_required' })
    const abs = safeWorkspacePath(rel)
    const stat = await fsp.stat(abs)
    if (!stat.isFile()) return res.status(400).json({ error: 'workspace_file_not_a_file' })
    const maxBytes = Math.max(20000, Math.min(1_000_000, Number(process.env.WEB_WORKSPACE_MAX_FILE_BYTES || 200000)))
    if (stat.size > maxBytes) {
      return res.status(413).json({ error: 'workspace_file_too_large', detail: `File exceeds ${maxBytes} bytes.` })
    }
    const content = await fsp.readFile(abs, 'utf8')
    res.json({
      path: toPosixRelative(abs),
      size: stat.size,
      content,
    })
  } catch (err: any) {
    res.status(400).json({ error: 'workspace_file_failed', detail: String(err?.message || err) })
  }
})

app.get(['/workspace/snapshot', '/api/workspace/snapshot', '/v1/workspace/snapshot'], async (req, res) => {
  try {
    const base = safeWorkspacePath(String((req.query as any)?.path || '.'))
    const limitRaw = Number((req.query as any)?.limit ?? 12000)
    const limit = Math.max(2000, Math.min(50000, Number.isFinite(limitRaw) ? limitRaw : 12000))
    const counter = { count: 0 }
    const nodes = await listWorkspaceTree(base, Math.min(3, WORKSPACE_MAX_DEPTH), counter)
    const treeLines = flattenTreeLines(nodes, '', 220)
    let snapshot = `Workspace root: ${WORKSPACE_ROOT}\n`
    snapshot += `Workspace base: ${toPosixRelative(base) || '.'}\n`
    snapshot += `Git branch: ${getGitBranch(base) || getGitBranch(WORKSPACE_ROOT) || 'unknown'}\n`
    snapshot += 'Visible tree:\n'
    snapshot += treeLines.length > 0 ? treeLines.join('\n') : '(empty)\n'

    const keyFiles = ['README.md', 'package.json', 'backend/package.json', 'frontend/package.json']
    for (const rel of keyFiles) {
      try {
        const abs = safeWorkspacePath(path.join(toPosixRelative(base), rel))
        const stat = await fsp.stat(abs)
        if (!stat.isFile() || stat.size > 18000) continue
        const txt = (await fsp.readFile(abs, 'utf8')).slice(0, 4000)
        snapshot += `\n\n# ${rel}\n${txt}`
      } catch {
        // ignore optional files
      }
    }

    if (snapshot.length > limit) snapshot = `${snapshot.slice(0, limit)}\n... [snapshot truncated]`
    res.json({ snapshot })
  } catch (err: any) {
    res.status(400).json({ error: 'workspace_snapshot_failed', detail: String(err?.message || err) })
  }
})

async function generateHandler(req: express.Request, res: express.Response) {
  const { prompt, model = 'codellama:7b-code', language, provider: providerInput } = req.body || {}
  const provider = parseProvider(providerInput)
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing "prompt" (string)' })
  }
  try {
    const fullPrompt =
      language && typeof language === 'string'
        ? `Write ${language} code.\n${prompt}`
        : prompt

    if (provider === 'openai') {
      const selectedModel = model || DEFAULT_MODELS.openai[0]
      const response = await generateWithOpenAI(fullPrompt, selectedModel)
      return res.json({ response, model: selectedModel, provider })
    }
    if (provider === 'anthropic') {
      const selectedModel = model || DEFAULT_MODELS.anthropic[0]
      const response = await generateWithAnthropic(fullPrompt, selectedModel)
      return res.json({ response, model: selectedModel, provider })
    }
    if (provider === 'gemini') {
      const selectedModel = model || DEFAULT_MODELS.gemini[0]
      const response = await generateWithGemini(fullPrompt, selectedModel)
      return res.json({ response, model: selectedModel, provider })
    }

    const installedModels = await listInstalledModels()
    const selectedModel = pickModel(model, installedModels)
    if (!selectedModel) {
      return res.status(503).json({
        error: 'no_models_installed',
        detail: 'No local Ollama models were found. Pull one model first, e.g. qwen2.5-coder:0.5b.',
      })
    }

    const upstream = await callOllama('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selectedModel, prompt: fullPrompt, stream: false }),
    })
    const data: any = await upstream.json()

    const response: string = (data?.response ?? '').toString()
    res.json({ response, model: selectedModel, provider })
  } catch (err: any) {
    console.error('POST /generate:', err?.message || err)
    res.status(502).json({ error: 'Generation failed', detail: String(err?.message || err) })
  }
}

app.post(['/generate', '/api/generate', '/v1/generate'], generateHandler)

app.post(['/generate/stream', '/api/generate/stream', '/v1/generate/stream'], async (req, res) => {
  const { prompt, model = 'codellama:7b-code', language, provider: providerInput } = req.body || {}
  const provider = parseProvider(providerInput)
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing "prompt" (string)' })
  }

  try {
    const fullPrompt =
      language && typeof language === 'string'
        ? `Write ${language} code.\n${prompt}`
        : prompt

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    if (provider !== 'ollama') {
      const selectedModel = model || DEFAULT_MODELS[provider][0]
      let response = ''
      if (provider === 'openai') response = await generateWithOpenAI(fullPrompt, selectedModel)
      if (provider === 'anthropic') response = await generateWithAnthropic(fullPrompt, selectedModel)
      if (provider === 'gemini') response = await generateWithGemini(fullPrompt, selectedModel)
      res.write(`data: ${JSON.stringify({ delta: response })}\n\n`)
      res.write('event: done\ndata: {}\n\n')
      res.end()
      return
    }

    const installedModels = await listInstalledModels()
    const selectedModel = pickModel(model, installedModels)

    if (!selectedModel) {
      res.write(`event: error\ndata: ${JSON.stringify({
        error: 'no_models_installed',
        detail: 'No local Ollama models were found. Pull one model first, e.g. qwen2.5-coder:0.5b.',
      })}\n\n`)
      res.end()
      return
    }

    let upstream: Response | null = null
    let lastUpstreamError = ''
    for (const base of OLLAMA_URLS) {
      try {
        const maybe = await fetch(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: selectedModel, prompt: fullPrompt, stream: true }),
        })
        if (maybe.ok && maybe.body) {
          upstream = maybe
          break
        }
        const txt = await maybe.text().catch(() => '')
        lastUpstreamError = txt || `${maybe.status}`
      } catch (e) {
        console.error('[ollama stream]', String(e))
        lastUpstreamError = String(e)
      }
    }

    if (!upstream?.body) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'stream_upstream_failed', detail: lastUpstreamError || 'unknown_upstream_error' })}\n\n`)
      res.end()
      return
    }

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      let nl = buf.indexOf('\n')
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) {
          try {
            const j = JSON.parse(line)
            if (j?.response) {
              res.write(`data: ${JSON.stringify({ delta: String(j.response) })}\n\n`)
            }
            if (j?.done) {
              res.write('event: done\ndata: {}\n\n')
              res.end()
              return
            }
          } catch {
            // Ignore malformed JSON chunks
          }
        }
        nl = buf.indexOf('\n')
      }
    }

    res.write('event: done\ndata: {}\n\n')
    res.end()
  } catch (err: any) {
    console.error('POST /generate/stream:', err?.message || err)
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Generation stream failed', detail: String(err?.message || err) })}\n\n`)
    res.end()
  }
})

app.listen(PORT, () => {
  console.log(`🚀 FANO-LABS backend server running on http://127.0.0.1:${PORT}`)
  console.log(`📊 Health check: http://127.0.0.1:${PORT}/health`)
})
