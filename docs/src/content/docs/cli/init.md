---
title: init
description: Create a new rpc.do project with an interactive wizard
---

The `init` command scaffolds a new rpc.do project with an interactive wizard.

## Usage

```bash
npx rpc.do init [project-name]
```

## Interactive Wizard

The wizard guides you through:

1. **Project name** - Name for your project (default: current directory name)
2. **Template selection** - Choose a starting template
3. **Include examples** - Whether to include example code
4. **Output directory** - Where to create the project

### Templates

| Template | Description |
|----------|-------------|
| **Basic** | Minimal DO with hello, add, math methods |
| **Chat** | Real-time chat with WebSocket support |
| **API** | REST-like CRUD operations |

## Example Session

```
$ npx rpc.do init

rpc.do project wizard

? Project name: my-chat-app
? Select template: Chat - Real-time chat with WebSocket support
? Include examples? Yes
? Output directory: ./my-chat-app

Creating project...

✓ Created wrangler.toml
✓ Created package.json
✓ Created tsconfig.json
✓ Created src/index.ts
✓ Created src/ChatRoom.ts
✓ Created src/types.ts

Next steps:
  cd my-chat-app
  npm install
  npm run dev
```

## Generated Files

### Basic Template

```
my-project/
├── wrangler.toml
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        # Worker entry point
    └── MyDO.ts         # Durable Object class
```

### Chat Template

```
my-chat-app/
├── wrangler.toml
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        # Worker with routing
    ├── ChatRoom.ts     # Chat DO with WebSocket
    └── types.ts        # Message, User types
```

### API Template

```
my-api/
├── wrangler.toml
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        # Worker with auth middleware
    ├── UserService.ts  # CRUD operations
    └── types.ts        # Entity types
```

## File Contents

### wrangler.toml

```toml
name = "my-project"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "MY_DO", class_name = "MyDO" }
]

[[migrations]]
tag = "v1"
new_classes = ["MyDO"]
```

### package.json

```json
{
  "name": "my-project",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "generate": "rpc.do generate"
  },
  "dependencies": {
    "@dotdo/rpc": "^1.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "rpc.do": "^0.2.0",
    "typescript": "^5.0.0",
    "wrangler": "^3.0.0"
  }
}
```

### src/index.ts (with router)

```typescript
import { router } from '@dotdo/rpc'

export { MyDO } from './MyDO'

interface Env {
  MY_DO: DurableObjectNamespace
}

export default router<Env>({
  bindings: {
    my: 'MY_DO',
  },
})
```

### src/MyDO.ts (Basic template)

```typescript
import { DurableRPC } from '@dotdo/rpc'

export class MyDO extends DurableRPC {
  async hello(name: string): Promise<string> {
    return `Hello, ${name}!`
  }

  async add(a: number, b: number): Promise<number> {
    return a + b
  }

  math = {
    multiply: async (a: number, b: number) => a * b,
    divide: async (a: number, b: number) => a / b,
  }
}
```

## Non-Interactive Mode

Pass all options as flags to skip the wizard:

```bash
npx rpc.do init my-project \
  --template chat \
  --examples \
  --output ./projects/my-project
```

## Options

| Option | Description |
|--------|-------------|
| `--template <name>` | Template to use (basic, chat, api) |
| `--examples` | Include example code |
| `--no-examples` | Skip example code |
| `--output <dir>` | Output directory |

## After Initialization

```bash
cd my-project
npm install
npm run dev     # Start local dev server
npm run deploy  # Deploy to Cloudflare
```

### Test Your DO

```bash
# In another terminal
curl http://localhost:8787/my/default/hello?name=World
# => "Hello, World!"

# Or use the client
npx rpc.do generate
```

```typescript
import { RPC } from 'rpc.do'

const $ = RPC('http://localhost:8787/my/default')
const greeting = await $.hello('World')
console.log(greeting)  // "Hello, World!"
```
