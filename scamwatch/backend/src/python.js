// Runs a script of capture/ and reads the JSON it prints. Secrets go through stdin
// or the child's environment, never on the command line.

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const PYTHON = process.env.CAPTURE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
export const captureDir = path.resolve(here, '../../capture')

export function runPython(script, args = [], { input, env = {}, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [script, ...args], { env: { ...process.env, ...env, PYTHONIOENCODING: 'utf-8' } })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); resolve({ error: 'timeout' }) }, timeoutMs)
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', () => { clearTimeout(timer); resolve({ error: 'crashed' }) })
    child.on('close', () => {
      clearTimeout(timer)
      try { resolve(JSON.parse(stdout)) } catch {
        console.error(`[python] ${path.basename(script)} output unreadable:`, stderr.slice(-500))
        resolve({ error: 'crashed' })
      }
    })
    if (input !== undefined) child.stdin.end(JSON.stringify(input))
    else child.stdin.end()
  })
}
