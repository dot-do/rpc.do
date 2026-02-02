---
title: CLI Overview
description: rpc.do command-line interface
---

The rpc.do CLI provides tools for type generation, schema introspection, and project scaffolding.

## Installation

The CLI is included with the `rpc.do` package:

```bash
npm install rpc.do

# Or run directly with npx
npx rpc.do
```

## Quick Start

The simplest way to use the CLI is zero-config mode:

```bash
npx rpc.do
```

This reads your `wrangler.toml`, finds your Durable Objects, and generates types to `.do/`.

## Commands

| Command | Description |
|---------|-------------|
| `generate` | Generate TypeScript types from DO source files |
| `introspect` | Fetch types from a running RPC server |
| `doctor` | Diagnose connection and configuration issues |
| `openapi` | Export OpenAPI specification |
| `init` | Create a new rpc.do project |
| `watch` | Watch mode for automatic regeneration |

## Usage

```bash
# Zero-config (reads wrangler.toml)
npx rpc.do

# Same as above
npx rpc.do generate

# Explicit source file
npx rpc.do generate --source ./src/MyDO.ts

# From running server
npx rpc.do introspect --url https://my-do.workers.dev

# Check endpoint health
npx rpc.do doctor --url https://my-do.workers.dev

# Export OpenAPI spec
npx rpc.do openapi --source ./src/MyDO.ts

# Create new project
npx rpc.do init my-project

# Watch mode
npx rpc.do watch
```

## How It Works

### Zero-config Mode

1. Reads `wrangler.toml` or `wrangler.jsonc`
2. Finds `durable_objects` bindings and class names
3. Locates source files containing those classes
4. Extracts full TypeScript types using the TypeScript compiler
5. Generates `.do/*.d.ts` with typed interfaces

### Example

Given this `wrangler.toml`:

```toml
[durable_objects]
bindings = [{ name = "CHAT", class_name = "ChatDO" }]
```

And this source file:

```typescript
// src/ChatDO.ts
export class ChatDO extends DigitalObject {
  async sendMessage(text: string): Promise<Message> { ... }
  users = {
    get: async (id: string): Promise<User | null> => { ... },
    list: async (): Promise<User[]> => { ... },
  }
}
```

Running `npx rpc.do` generates:

```typescript
// .do/ChatDO.d.ts
export interface ChatDOAPI {
  sendMessage(text: string): Promise<Message>
  users: {
    get(id: string): Promise<User | null>
    list(): Promise<User[]>
  }
}

// .do/index.ts
export type { ChatDOAPI } from './ChatDO'
```

## Global Options

| Option | Description |
|--------|-------------|
| `--source <file>` | TypeScript source file (supports globs) |
| `--url <url>` | Schema endpoint URL |
| `--output <dir>` | Output directory (default: `.do`) |
| `--help` | Show help message |

## Command Reference

- [generate](/cli/generate/) - Type generation from source
- [introspect](/cli/introspect/) - Fetch types from server
- [doctor](/cli/doctor/) - Diagnose issues
- [openapi](/cli/openapi/) - Export OpenAPI spec
- [init](/cli/init/) - Project scaffolding
