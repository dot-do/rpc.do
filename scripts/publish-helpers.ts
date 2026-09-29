/**
 * Pure helpers for scripts/publish.ts, kept side-effect free so they can be
 * unit tested (tests/publish-script.test.ts).
 */

/**
 * Decide from `npm view <name>@<version> version` whether that version is on
 * npm. npm exits 1 with E404 for an unknown version, and prints the version
 * (plain or JSON-quoted) when it exists.
 */
export function isPublishedFromView(status: number | null, stdout: string, version: string): boolean {
  if (status !== 0) return false
  const printed = stdout.trim().replace(/^"|"$/g, '')
  return printed === version
}

/**
 * npm web-auth URLs look like
 *   https://www.npmjs.com/login?next=/login/cli/<uuid>   (npm login --auth-type=web)
 *   https://www.npmjs.com/auth/cli/<uuid>                 (publish OTP via web)
 * Registry URLs (https://registry.npmjs.org/...) must never match.
 */
const AUTH_URL = /https:\/\/(?:www\.)?npmjs\.com\/(?:login|auth)\S*/g

/** Every npm login/auth URL in `text`, in order, without duplicates. */
export function extractAuthUrls(text: string): string[] {
  // Strip ANSI escapes and carriage returns a PTY may inject.
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')
  const seen = new Set<string>()
  for (const match of clean.matchAll(AUTH_URL)) {
    seen.add(match[0].replace(/[.,;:)\]'"]+$/, ''))
  }
  return [...seen]
}

/** Minimal Tcl quoting: leave safe words alone, brace-wrap the rest. */
export function quoteForTcl(s: string): string {
  if (/^[A-Za-z0-9._/@:=-]+$/.test(s)) return s
  if (!/[{}\\]/.test(s)) return `{${s}}`
  return `"${s.replace(/[\\$[\]"]/g, (c) => `\\${c}`)}"`
}

/**
 * Tcl program that runs an npm command under a PTY (so npm will prompt) and
 * presses Enter on "Press ENTER to open in the browser...". Opening the URL is
 * done by the Node parent, which watches expect's output.
 */
export function expectScript(command: string[], timeoutSeconds: number): string {
  return [
    `set timeout ${timeoutSeconds}`,
    'log_user 1',
    ['spawn', ...command].map(quoteForTcl).join(' '),
    'expect {',
    '  -nocase -re {press enter to open in the browser} { send "\\r"; exp_continue }',
    '  timeout { puts stderr "*** timed out waiting for npm ***"; exit 2 }',
    '  eof',
    '}',
    'catch wait result',
    'exit [lindex $result 3]',
  ].join('\n')
}
