#!/usr/bin/env tsx
/**
 * Local publish for rpc.do (CI only opens the changesets "version packages" PR).
 *
 *   pnpm release   # build + test + this script
 *
 * 1. Refuses `workspace:` protocols in dependencies (`pnpm check:publish`).
 * 2. Skips if rpc.do@<version> is already on npm.
 * 3. `npm whoami`; if missing/expired, `npm login --auth-type=web`.
 * 4. `npm publish --access public --auth-type=web` (TouchID / WebAuthn).
 * 5. Non-TTY caller (an agent): npm runs under `expect` for a PTY, Enter is
 *    pressed on "Press ENTER to open in the browser...", and the auth URL npm
 *    prints is opened with `open` / `xdg-open` so the founder approves in the
 *    browser. Gives up after 15 minutes.
 * 6. Restores any files it (or npm lifecycle scripts) modified.
 *
 * Never prints tokens: only npm's own output and the username are shown.
 */

import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectScript, extractAuthUrls, isPublishedFromView } from './publish-helpers.ts'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY = 'https://registry.npmjs.org/'
const TIMEOUT_SECONDS = 15 * 60
const RESTORE = ['package.json', 'README.md']

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

function which(bin: string): string | undefined {
  const r = spawnSync('which', [bin], { stdio: 'pipe' })
  return r.status === 0 ? r.stdout.toString().trim() || undefined : undefined
}

function openInBrowser(url: string): void {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
  console.log(`\n[publish] opening ${url} for approval`)
  spawn(opener, [url], { stdio: 'ignore', detached: true }).on('error', () => {
    console.warn(`[publish] could not run ${opener}; open the URL above manually`)
  }).unref()
}

/**
 * Run `npm <args>`, handling the web-auth prompt. TTY: plain inherit, the human
 * answers npm directly. Non-TTY: expect gives npm a PTY and presses Enter; we
 * open the auth URL ourselves (npm's own opener is pointed at a no-op so the
 * URL does not open twice).
 */
function runNpm(args: string[]): Promise<number> {
  if (isInteractive()) {
    const r = spawnSync('npm', args, { cwd: rootDir, stdio: 'inherit' })
    return Promise.resolve(r.status ?? 1)
  }
  if (!which('expect')) {
    console.warn('[publish] non-TTY caller and `expect` not on PATH; npm cannot prompt for web auth.')
    const r = spawnSync('npm', args, { cwd: rootDir, stdio: 'inherit' })
    return Promise.resolve(r.status ?? 1)
  }
  const noop = which('true')
  const npmArgs = noop ? [...args, `--browser=${noop}`] : args
  const child = spawn('expect', ['-c', expectScript(['npm', ...npmArgs], TIMEOUT_SECONDS)], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const opened = new Set<string>()
  let partial = ''
  const watch = (chunk: Buffer, sink: NodeJS.WriteStream) => {
    sink.write(chunk)
    // Scan complete lines only, so a URL split across chunks is not opened truncated.
    const text = partial + chunk.toString()
    const cut = text.lastIndexOf('\n') + 1
    partial = text.slice(cut).slice(-4096)
    for (const url of extractAuthUrls(text.slice(0, cut))) {
      if (!opened.has(url)) {
        opened.add(url)
        openInBrowser(url)
      }
    }
  }
  child.stdout.on('data', (c: Buffer) => watch(c, process.stdout))
  child.stderr.on('data', (c: Buffer) => watch(c, process.stderr))
  const killer = setTimeout(() => {
    console.error('[publish] timed out after 15 minutes')
    child.kill('SIGTERM')
  }, (TIMEOUT_SECONDS + 30) * 1000)
  return new Promise((resolve) => {
    child.on('close', (code) => {
      clearTimeout(killer)
      resolve(code ?? 1)
    })
  })
}

async function ensureLoggedIn(): Promise<void> {
  const whoami = spawnSync('npm', ['whoami', `--registry=${REGISTRY}`], { stdio: 'pipe' })
  if (whoami.status === 0) {
    console.log(`npm: logged in as ${whoami.stdout.toString().trim()}`)
    return
  }
  console.log('npm: not logged in (or token expired), starting web login...')
  const code = await runNpm(['login', '--auth-type=web', `--registry=${REGISTRY}`])
  if (code !== 0) throw new Error(`npm login failed (exit ${code})`)
}

async function main(): Promise<number> {
  const check = spawnSync('pnpm', ['check:publish'], { cwd: rootDir, stdio: 'inherit' })
  if (check.status !== 0) return check.status ?? 1

  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8')) as { name: string; version: string }
  const view = spawnSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version', `--registry=${REGISTRY}`], {
    stdio: 'pipe',
  })
  if (isPublishedFromView(view.status, view.stdout.toString(), pkg.version)) {
    console.log(`${pkg.name}@${pkg.version} is already on npm; nothing to publish.`)
    return 0
  }
  console.log(`Publishing ${pkg.name}@${pkg.version}...`)

  await ensureLoggedIn()

  const originals = new Map<string, string>()
  for (const f of RESTORE) {
    try {
      originals.set(f, readFileSync(join(rootDir, f), 'utf-8'))
    } catch {
      // file absent; nothing to restore
    }
  }
  try {
    const code = await runNpm(['publish', '--access', 'public', '--auth-type=web', `--registry=${REGISTRY}`])
    if (code !== 0) {
      console.error(`Failed to publish ${pkg.name}@${pkg.version} (exit ${code})`)
      return code
    }
    console.log(`Published ${pkg.name}@${pkg.version}`)
    return 0
  } finally {
    for (const [f, content] of originals) {
      const path = join(rootDir, f)
      if (readFileSync(path, 'utf-8') !== content) writeFileSync(path, content)
    }
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
