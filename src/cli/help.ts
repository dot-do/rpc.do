/**
 * CLI Help - Help text output
 */

export function printHelp(): void {
  console.log(`
rpc.do - Zero-config type generation for Durable Objects

QUICK START (Zero-config):
  npx rpc.do

  That's it! Reads your wrangler.toml, finds your DOs, generates types to .do/

HOW IT WORKS:
  1. Reads wrangler.toml or wrangler.jsonc
  2. Finds durable_objects bindings → class names
  3. Locates source files with those classes
  4. Extracts full TypeScript types
  5. Generates .do/*.d.ts with typed interfaces

USAGE:
  npx rpc.do                       Zero-config (recommended)
  npx rpc.do generate              Same as above
  npx rpc.do generate --source X   Explicit source file(s)
  npx rpc.do generate --url X      Runtime schema (weak types)
  npx rpc.do watch                 Watch mode
  npx rpc.do init [name]           Create new project
  npx rpc.do doctor                Diagnose RPC connection issues
  npx rpc.do doctor --url X        Check specific endpoint

EXAMPLE:
  # wrangler.toml
  [durable_objects]
  bindings = [{ name = "CHAT", class_name = "ChatDO" }]

  # src/ChatDO.ts
  export class ChatDO extends DigitalObject {
    async sendMessage(text: string): Promise<Message> { ... }
    users = {
      get: async (id: string): Promise<User | null> => { ... },
      list: async (): Promise<User[]> => { ... },
    }
  }

  # Run
  $ npx rpc.do
  Found wrangler config with 1 Durable Object(s):
    - ChatDO (binding: CHAT)

  Generated 2 file(s):
    - .do/ChatDO.d.ts
    - .do/index.ts

  # Import
  import type { ChatDOAPI } from './.do'

EXPLICIT OPTIONS:
  --source <file>   TypeScript source (supports globs: "./do/*.ts")
  --url <url>       Schema endpoint for runtime types
  --output <dir>    Output directory (default: .do)

WATCH MODE:
  npx rpc.do watch                 Auto-regenerate on file changes
  npx rpc.do watch --source X      Watch specific files
  npx rpc.do watch --url X         Poll endpoint for changes

INIT:
  npx rpc.do init [project-name]   Create new project with examples

DOCTOR:
  npx rpc.do doctor                Diagnose connection and config issues
  npx rpc.do doctor --url <url>    Check a specific RPC endpoint

  Checks performed:
    - Configuration file detection
    - Basic connectivity to endpoint
    - Schema endpoint accessibility
    - Schema format validation
    - Wrangler config detection
`)
}
