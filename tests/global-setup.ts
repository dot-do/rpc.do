/**
 * Vitest global setup: the CLI tests spawn `node dist/cli.js`, so a fresh
 * checkout that runs `pnpm test` before `pnpm build` would fail them with
 * empty output. Build once when the CLI bundle is missing.
 */
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export default function setup(): void {
  const root = fileURLToPath(new URL('..', import.meta.url))
  if (existsSync(`${root}dist/cli.js`)) return
  execSync('pnpm build', { cwd: root, stdio: 'inherit' })
}
