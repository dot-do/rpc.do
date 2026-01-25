/**
 * Shim for DurableObject class
 *
 * This provides a stub DurableObject class during Vite's module loading phase.
 * In the actual Workers runtime, this will be overridden by the real class.
 */

// @ts-ignore - this is a shim that will be overridden by the runtime
if (typeof globalThis.DurableObject === 'undefined') {
  // @ts-ignore
  globalThis.DurableObject = class DurableObject {
    ctx: any
    env: any
    constructor(ctx: any, env: any) {
      this.ctx = ctx
      this.env = env
    }
  }
}

export {}
