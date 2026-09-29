import { describe, expect, it } from 'vitest'
import { expectScript, extractAuthUrls, isPublishedFromView, quoteForTcl } from '../scripts/publish-helpers'

describe('isPublishedFromView', () => {
  it('is true when npm view prints the exact version', () => {
    expect(isPublishedFromView(0, '0.3.0\n', '0.3.0')).toBe(true)
    expect(isPublishedFromView(0, '"0.3.0"\n', '0.3.0')).toBe(true)
  })

  it('is false on E404 (non-zero exit) or a different/empty version', () => {
    expect(isPublishedFromView(1, '', '9.9.9')).toBe(false)
    expect(isPublishedFromView(0, '', '0.3.1')).toBe(false)
    expect(isPublishedFromView(0, '0.3.0', '0.3.1')).toBe(false)
    expect(isPublishedFromView(null, '0.3.0', '0.3.0')).toBe(false)
  })
})

describe('extractAuthUrls', () => {
  it('finds the web login URL', () => {
    const out = 'npm notice Log in on https://registry.npmjs.org/\nLogin at:\nhttps://www.npmjs.com/login?next=/login/cli/4b1c2d3e-aaaa-bbbb-cccc-1234567890ab\nPress ENTER to open in the browser...'
    expect(extractAuthUrls(out)).toEqual(['https://www.npmjs.com/login?next=/login/cli/4b1c2d3e-aaaa-bbbb-cccc-1234567890ab'])
  })

  it('finds the publish auth URL through PTY noise and dedupes', () => {
    const url = 'https://www.npmjs.com/auth/cli/0f0e0d0c-1111-2222-3333-444455556666'
    const out = `\x1b[2K\rAuthenticate your account at:\r\n${url}\r\n${url}.\r\n`
    expect(extractAuthUrls(out)).toEqual([url])
  })

  it('ignores registry and unrelated URLs', () => {
    expect(extractAuthUrls('npm notice Publishing to https://registry.npmjs.org/ with tag latest')).toEqual([])
    expect(extractAuthUrls('see https://docs.npmjs.com/cli/v10 and https://www.npmjs.com/package/rpc.do')).toEqual([])
  })
})

describe('expect script', () => {
  it('quotes Tcl words safely', () => {
    expect(quoteForTcl('--auth-type=web')).toBe('--auth-type=web')
    expect(quoteForTcl('a b')).toBe('{a b}')
    expect(quoteForTcl('a{b')).toBe('"a{b"')
  })

  it('spawns npm, presses Enter on the browser prompt, and honours the timeout', () => {
    const script = expectScript(['npm', 'publish', '--access', 'public'], 900)
    expect(script).toContain('set timeout 900')
    expect(script).toContain('spawn npm publish --access public')
    expect(script).toMatch(/press enter to open in the browser\} \{ send "\\r"/)
  })
})
