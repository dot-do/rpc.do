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
  npx rpc.do openapi --source X    Export OpenAPI spec from source
  npx rpc.do openapi --url X       Export OpenAPI spec from endpoint
  npx rpc.do introspect --url X    Fetch types from running server
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

INIT (Interactive Wizard):
  npx rpc.do init [project-name]   Create new project with interactive wizard

  The wizard guides you through:
    1. Project name (default: current directory name)
    2. Template selection:
       - Basic: Minimal DO with hello, add, math methods
       - Chat: Real-time chat with WebSocket support
       - API: REST-like CRUD operations
    3. Include examples? (y/n)
    4. Output directory

  Generates wrangler.toml, tsconfig.json, package.json, and DO class files

DOCTOR:
  npx rpc.do doctor                Diagnose connection and config issues
  npx rpc.do doctor --url <url>    Check a specific RPC endpoint

  Checks performed:
    - Configuration file detection
    - Basic connectivity to endpoint
    - Schema endpoint accessibility
    - Schema format validation
    - Wrangler config detection

INTROSPECT:
  npx rpc.do introspect --url <url>              Fetch schema and generate types
  npx rpc.do introspect --url <url> --output X   Specify output directory

  Connects to a running RPC server, fetches the runtime schema from
  the /__schema endpoint, and generates TypeScript type definitions.

  Note: Runtime introspection provides weak types (unknown params/returns).
  For full type safety, use 'npx rpc.do generate --source' instead.

OPENAPI:
  npx rpc.do openapi --source ./MyDO.ts          Export from TypeScript source
  npx rpc.do openapi --url <url>                 Export from running server
  npx rpc.do openapi --source X --output api.json  Specify output file

  Options:
    --source <file>     TypeScript source file to extract schema from
    --url <url>         RPC endpoint to fetch schema from
    --output <file>     Output file (default: openapi.json)
    --title <string>    API title for OpenAPI info
    --version <string>  API version (default: 1.0.0)
    --server <url>      Server URL to include in spec
    --format <3.0|3.1>  OpenAPI version (default: 3.0)

  Example:
    npx rpc.do openapi --source ./src/ChatDO.ts --title "Chat API"

  The generated OpenAPI spec can be used with:
    - Swagger UI for interactive documentation
    - OpenAPI Generator for client SDKs
    - Postman, Insomnia, and other API tools
`)
}
