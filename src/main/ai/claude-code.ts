import { spawn, type ChildProcess } from 'node:child_process'
import { statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { AI_PROVIDERS } from '../../shared/providers'
import type { AiConfig } from '../settings'
import type { AiClient, ChatRequest } from './types'

// Writes notes with Claude Code, installed and signed in on this computer, so they count toward the
// user's own Claude plan instead of being billed through the API. Heard runs the unmodified `claude`
// program in print mode (`claude -p`) and never sees the sign-in: Claude Code keeps that itself.
// Flags and output format: https://code.claude.com/docs/en/cli-reference and .../headless

const SETUP_URL = 'https://code.claude.com/docs/en/setup'
const NOT_INSTALLED = `Claude Code isn't installed on this computer. Install it (${SETUP_URL}), then run claude in a terminal once to sign in.`
const NOT_SIGNED_IN = "Claude Code isn't signed in. Run claude in a terminal and sign in with your Claude account."
const NOT_A_PLAN =
  'Claude Code is signed in with an API key or a cloud provider, so it would bill that rather than your Claude plan. To use your plan, run claude in a terminal, type /login and choose your Claude account.'
const ANSWER_TIMEOUT_MS = 10 * 60_000
const STATUS_TIMEOUT_MS = 30_000
/** Claude Code's whole prompt. The conversation itself goes in the instructions file (see conversationFor). */
const PROMPT = "Write the assistant's next reply to the conversation at the end of your instructions, and nothing else."
/** Model names as Claude Code takes them: aliases such as opus, and full names such as claude-opus-4-6[1m]. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Where `claude` is: first on the PATH, so it's the one a terminal runs (an older install may linger
 * elsewhere), then where its installers put it, since an app opened from the Dock may not get that PATH.
 */
function findClaude(): string | null {
  const home = homedir()
  const dirs = (process.env.PATH ?? '')
    .split(delimiter)
    .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
  const { LOCALAPPDATA, APPDATA } = process.env
  const candidates =
    process.platform === 'win32'
      ? [
          // In each folder the program itself before npm's .cmd wrapper, which only cmd.exe can run.
          ...dirs.flatMap((dir) => [join(dir, 'claude.exe'), join(dir, 'claude.cmd')]),
          join(home, '.local', 'bin', 'claude.exe'),
          ...(LOCALAPPDATA ? [join(LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'claude.exe')] : []),
          ...(APPDATA ? [join(APPDATA, 'npm', 'claude.cmd')] : [])
        ]
      : [
          ...dirs.map((dir) => join(dir, 'claude')),
          join(home, '.local', 'bin', 'claude'),
          join(home, '.claude', 'local', 'claude'),
          '/opt/homebrew/bin/claude',
          '/usr/local/bin/claude'
        ]
  return candidates.find(isFile) ?? null
}

/** Heard's environment, less what would make Claude Code bill something other than the plan. */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(process.env)) {
    // An API key or token here would win over the plan sign-in, and the plan talks to Anthropic itself,
    // not to another base URL. CLAUDECODE marks a Claude Code session (Heard started from one with
    // npm run dev), which Claude Code may refuse to start another inside.
    if (/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDECODE)$/i.test(name)) continue
    env[name] = value
  }
  // Claude Code attaches any file named after an @ in its prompt. Heard's prompt is a fixed sentence
  // (see conversationFor), and versions that have this switch don't read such files at all.
  env.CLAUDE_CODE_DISABLE_FILE_MENTIONS = '1'
  return env
}

/** Starts `claude`. An npm install on Windows is a .cmd script, which only cmd.exe can run. */
function launch(exe: string, args: string[], cwd: string): ChildProcess {
  const options = { cwd, env: childEnv(), windowsHide: true }
  if (process.platform === 'win32' && /\.cmd$/i.test(exe)) {
    // Every argument is a fixed flag, a checked model name (MODEL_NAME) or a path Heard made, none
    // containing quotes, so quoting is enough.
    return spawn([exe, ...args].map((part) => `"${part}"`).join(' '), { ...options, shell: true })
  }
  return spawn(exe, args, options)
}

/** Ends a run, including the claude that a .cmd script started on Windows. */
function stop(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') {
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    spawn(taskkill, ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }).on('error', () => child.kill())
  } else {
    child.kill()
  }
}

interface RunOptions {
  cwd: string
  input?: string
  signal?: AbortSignal
  timeoutMs: number
  onLine(line: string): void
}

/** Runs `claude` with these arguments, passing each line it prints to `onLine`. */
function runClaude(args: string[], options: RunOptions): Promise<{ code: number | null; stderr: string }> {
  const exe = findClaude()
  if (!exe) return Promise.reject(new Error(NOT_INSTALLED))
  return new Promise((resolve, reject) => {
    const child = launch(exe, args, options.cwd)
    let stdout = ''
    let stderr = ''
    let settled = false
    const settle = (finish: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      finish()
    }
    const onAbort = () => {
      stop(child)
      settle(() => reject(new Error('Stopped.')))
    }
    const timer = setTimeout(() => {
      stop(child)
      settle(() => reject(new Error('Claude Code took too long to answer.')))
    }, options.timeoutMs)
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })

    const readLines = (final: boolean) => {
      let newline: number
      while ((newline = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newline).trim()
        stdout = stdout.slice(newline + 1)
        if (line && !settled) options.onLine(line)
      }
      if (final && stdout.trim() && !settled) options.onLine(stdout.trim())
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      readLines(false)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000)
    })
    child.on('error', (err) => {
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
      settle(() => reject(new Error(missing ? NOT_INSTALLED : `Could not start Claude Code: ${err.message}`)))
    })
    child.on('close', (code) => {
      readLines(true)
      settle(() => resolve({ code, stderr: stderr.trim() }))
    })
    // Claude Code may exit before reading its input, e.g. when it isn't signed in.
    child.stdin?.on('error', () => {})
    child.stdin?.end(options.input ?? '')
  })
}

/** One line of `--output-format stream-json`, with only the fields Heard reads. */
interface StreamLine {
  type?: string
  parent_tool_use_id?: string | null
  event?: { type?: string; delta?: { type?: string; text?: string } }
  subtype?: string
  is_error?: boolean
  result?: string
  errors?: string[]
  stop_reason?: string | null
}

function claudeArgs(config: AiConfig, request: ChatRequest, systemFile: string): string[] {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    // Heard's instructions replace Claude Code's own, and it gets no tools, MCP servers or user settings
    // (so no hooks or plugins): it only writes text, and nothing set up for coding runs alongside it.
    // Its prompt is a fixed sentence, so nothing in a meeting can make it attach a file (conversationFor).
    '--system-prompt-file', systemFile,
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', 'project',
    '--max-turns', '1',
    '--no-session-persistence',
    '--effort', request.effort,
    // "default" leaves the choice to Claude Code, which picks a model the plan includes.
    ...(config.model && config.model !== 'default' ? ['--model', config.model] : [])
  ]
}

/**
 * The conversation, written out in full and ending on the turn to answer, for the end of the instructions
 * file. It never goes in Claude Code's prompt: that is typed input, where an @ before a path attaches that
 * file from this computer, and what was said in a meeting can steer what Claude wrote in earlier turns.
 * The instructions file is read as it is.
 */
function conversationFor(request: ChatRequest): string {
  const turns = request.messages.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join('\n\n')
  return `<conversation>\n${turns}\n</conversation>`
}

/** What Claude Code reported, worded for the error banner. */
function failure(message: string): string {
  const text = message.trim()
  if (/not logged in|\/login|oauth token|authentication/i.test(text)) return NOT_SIGNED_IN
  return `Claude Code: ${text.slice(0, 300)}`
}

export function claudeCodeClient(config: AiConfig): AiClient {
  return {
    async stream(request, onText, signal) {
      // On Windows an npm install's claude.cmd runs through cmd.exe, and the model is the one setting
      // that reaches its command line.
      if (config.model && config.model !== 'default' && !MODEL_NAME.test(config.model)) {
        throw new Error(`Claude Code can't use the model "${config.model}". Choose default, opus, sonnet or haiku in Settings → AI.`)
      }
      // An empty folder to run in, so no project's settings or CLAUDE.md come along, with the instructions in it.
      const dir = await mkdtemp(join(tmpdir(), 'heard-claude-'))
      try {
        const systemFile = join(dir, 'system.md')
        await writeFile(systemFile, `${request.system}\n\n${request.context}\n\n${conversationFor(request)}`, 'utf8')
        const seen: { text: string; result?: StreamLine } = { text: '' }
        const { code, stderr } = await runClaude(claudeArgs(config, request, systemFile), {
          cwd: dir,
          input: PROMPT,
          signal,
          timeoutMs: ANSWER_TIMEOUT_MS,
          onLine(line) {
            let message: StreamLine
            try {
              message = JSON.parse(line) as StreamLine
            } catch {
              return
            }
            if (message.type === 'result') seen.result = message
            if (message.type !== 'stream_event' || message.parent_tool_use_id) return
            const { event } = message
            if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
              seen.text += event.delta.text
              onText(event.delta.text)
            }
          }
        })
        const { result } = seen
        if (!result) throw new Error(failure(stderr || `Claude Code stopped without answering (exit code ${code ?? 'none'}).`))
        if (result.stop_reason === 'refusal') throw new Error('Claude declined to answer this one.')
        if (result.is_error || result.subtype !== 'success') {
          throw new Error(failure(result.result || result.errors?.join(' ') || stderr || `It stopped early (${result.subtype}).`))
        }
        return result.result || seen.text
      } finally {
        await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
      }
    },

    async listModels() {
      // Claude Code takes model aliases rather than listing models, so this checks it's ready to use, in
      // an empty folder of its own so no settings left in the shared temp folder come along.
      const dir = await mkdtemp(join(tmpdir(), 'heard-claude-'))
      const status = { json: '' }
      let code: number | null
      try {
        ;({ code } = await runClaude(['auth', 'status'], {
          cwd: dir,
          timeoutMs: STATUS_TIMEOUT_MS,
          onLine(line) {
            status.json += `${line}\n`
          }
        }))
      } finally {
        await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
      }
      let method: string | undefined
      try {
        method = (JSON.parse(status.json) as { authMethod?: string }).authMethod
      } catch {
        // Not JSON: the exit code still says whether it's signed in.
      }
      if (code !== 0 || method === 'none') throw new Error(NOT_SIGNED_IN)
      if (method && method !== 'claude.ai' && method !== 'oauth_token') throw new Error(NOT_A_PLAN)
      return AI_PROVIDERS['claude-code'].suggestedModels
    }
  }
}
