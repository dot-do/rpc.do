---
title: openapi
description: Export OpenAPI specification from your RPC schema
---

The `openapi` command generates an OpenAPI 3.0/3.1 specification from your Durable Object source files or a running server.

## Usage

```bash
# From TypeScript source
npx rpc.do openapi --source ./src/MyDO.ts

# From running server
npx rpc.do openapi --url https://my-do.workers.dev

# With custom output
npx rpc.do openapi --source ./src/MyDO.ts --output api.json
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--source <file>` | TypeScript source file | - |
| `--url <url>` | RPC endpoint URL | - |
| `--output <file>` | Output file path | `openapi.json` |
| `--title <string>` | API title | Class name |
| `--version <string>` | API version | `1.0.0` |
| `--server <url>` | Server URL to include | - |
| `--format <3.0\|3.1>` | OpenAPI version | `3.0` |

## Example

### Source File

```typescript
// src/UserService.ts
export class UserService extends DurableRPC {
  /**
   * Create a new user
   * @param data User creation data
   * @returns The created user
   */
  async createUser(data: CreateUserInput): Promise<User> {
    // ...
  }

  /**
   * Get a user by ID
   */
  async getUser(id: string): Promise<User | null> {
    // ...
  }

  admin = {
    /** List all users */
    listUsers: async (): Promise<User[]> => { ... },
    /** Delete a user */
    deleteUser: async (id: string): Promise<void> => { ... },
  }
}
```

### Generated OpenAPI

```bash
npx rpc.do openapi --source ./src/UserService.ts --title "User API" --server https://api.example.com
```

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "User API",
    "version": "1.0.0"
  },
  "servers": [
    { "url": "https://api.example.com" }
  ],
  "paths": {
    "/createUser": {
      "post": {
        "operationId": "createUser",
        "summary": "Create a new user",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/CreateUserInput" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Successful response",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/User" }
              }
            }
          }
        }
      }
    },
    "/getUser": {
      "post": {
        "operationId": "getUser",
        "summary": "Get a user by ID",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "id": { "type": "string" }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": {
                  "oneOf": [
                    { "$ref": "#/components/schemas/User" },
                    { "type": "null" }
                  ]
                }
              }
            }
          }
        }
      }
    },
    "/admin/listUsers": {
      "post": {
        "operationId": "admin.listUsers",
        "summary": "List all users",
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": { "$ref": "#/components/schemas/User" }
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "User": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "email": { "type": "string" }
        }
      },
      "CreateUserInput": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "email": { "type": "string" }
        },
        "required": ["name", "email"]
      }
    }
  }
}
```

## Use Cases

### Swagger UI

Host interactive API documentation:

```bash
npx rpc.do openapi --source ./src/MyDO.ts --output public/openapi.json
npx swagger-ui-express public/openapi.json
```

### Client Generation

Generate SDKs in other languages:

```bash
npx rpc.do openapi --source ./src/MyDO.ts

# Generate Python client
openapi-generator-cli generate -i openapi.json -g python -o ./sdk/python

# Generate Go client
openapi-generator-cli generate -i openapi.json -g go -o ./sdk/go
```

### Postman/Insomnia

Import the OpenAPI spec directly into API testing tools:

1. Generate the spec: `npx rpc.do openapi --source ./src/MyDO.ts`
2. Import `openapi.json` into Postman or Insomnia
3. All endpoints are automatically configured

### API Gateway Integration

Use with Kong, AWS API Gateway, or other API management tools that accept OpenAPI specs.

## Limitations

### From Source (`--source`)

- Requires TypeScript source code access
- JSDoc comments are converted to OpenAPI descriptions
- Complex types are converted to JSON Schema

### From URL (`--url`)

- Limited to runtime schema information
- No parameter names (uses `arg0`, `arg1`, etc.)
- No detailed type information (uses `any`)
- Useful for basic documentation only

## Programmatic API

You can also use the OpenAPI conversion programmatically:

```typescript
import { toOpenAPI } from 'rpc.do'

const schema = await $.schema()  // Get RPC schema
const openapi = toOpenAPI(schema, {
  title: 'My API',
  version: '1.0.0',
  servers: [{ url: 'https://api.example.com' }],
})

// openapi is an OpenAPI 3.0 object
console.log(JSON.stringify(openapi, null, 2))
```
