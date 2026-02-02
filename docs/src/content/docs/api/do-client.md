---
title: DO Client Features
description: Built-in SQL, storage, and collection access
---

Every RPC client created with `RPC()` includes built-in features for accessing Durable Object capabilities remotely.

## SQL Queries

Execute SQL queries on your DO's SQLite database using tagged templates:

```typescript
const $ = RPC('https://my-do.workers.dev')

// Tagged templates prevent SQL injection
const users = await $.sql`SELECT * FROM users WHERE active = ${true}`.all()
const user = await $.sql`SELECT * FROM users WHERE id = ${id}`.first()
await $.sql`UPDATE users SET name = ${name} WHERE id = ${id}`.run()
```

### Query Methods

```typescript
interface SqlQuery<R> {
  /** Get all rows */
  all(): Promise<R[]>

  /** Get first row or null */
  first(): Promise<R | null>

  /** Execute without returning rows */
  run(): Promise<void>

  /** Get raw result with metadata */
  raw(): Promise<SqlQueryResult<R>>
}
```

### SqlQueryResult

```typescript
interface SqlQueryResult<R> {
  results: R[]
  success: boolean
  meta?: {
    changes?: number
    last_row_id?: number
    rows_read?: number
    rows_written?: number
  }
}
```

### Examples

```typescript
// Parameterized queries (values are safely bound)
const user = await $.sql`
  SELECT * FROM users
  WHERE email = ${email} AND active = ${true}
`.first()

// Insert with returning
const inserted = await $.sql`
  INSERT INTO users (name, email)
  VALUES (${name}, ${email})
  RETURNING *
`.first()

// Update with count
const result = await $.sql`
  UPDATE users SET active = false WHERE last_login < ${cutoff}
`.raw()
console.log(`Updated ${result.meta?.changes} users`)

// Complex queries
const stats = await $.sql`
  SELECT role, COUNT(*) as count
  FROM users
  WHERE active = true
  GROUP BY role
  ORDER BY count DESC
`.all()
```

## Remote Storage

Access your DO's key-value storage:

```typescript
const $ = RPC('https://my-do.workers.dev')

// Get value
const config = await $.storage.get('config')

// Put value
await $.storage.put('config', { theme: 'dark', locale: 'en' })

// Delete value
await $.storage.delete('config')

// Check existence
const exists = await $.storage.has('config')

// List keys
const keys = await $.storage.list()

// Get multiple
const values = await $.storage.getMany(['key1', 'key2', 'key3'])

// Put multiple
await $.storage.putMany({
  key1: 'value1',
  key2: 'value2',
})

// Delete multiple
await $.storage.deleteMany(['key1', 'key2'])
```

### RemoteStorage Interface

```typescript
interface RemoteStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  put<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  has(key: string): Promise<boolean>
  list(options?: { prefix?: string; limit?: number }): Promise<string[]>
  getMany<T = unknown>(keys: string[]): Promise<Map<string, T>>
  putMany<T = unknown>(entries: Record<string, T>): Promise<void>
  deleteMany(keys: string[]): Promise<void>
}
```

## Collections

MongoDB-style queries on DO SQLite:

```typescript
const $ = RPC('https://my-do.workers.dev')

// Get a collection
const users = $.collection('users')

// Basic CRUD
await users.put('user-1', { name: 'Alice', role: 'admin', active: true })
const user = await users.get('user-1')
await users.delete('user-1')

// Query with filters
const admins = await users.find({ role: 'admin' })
const active = await users.find({ active: true })

// Complex filters
const results = await users.find({
  role: { $in: ['admin', 'moderator'] },
  createdAt: { $gte: '2024-01-01' },
  active: true,
})
```

### Filter Operators

```typescript
// Comparison
{ field: value }           // Equality ($eq)
{ field: { $eq: value } }  // Explicit equality
{ field: { $ne: value } }  // Not equal
{ field: { $gt: value } }  // Greater than
{ field: { $gte: value } } // Greater than or equal
{ field: { $lt: value } }  // Less than
{ field: { $lte: value } } // Less than or equal

// Array membership
{ field: { $in: [a, b, c] } }   // In array
{ field: { $nin: [a, b, c] } }  // Not in array

// Existence
{ field: { $exists: true } }   // Field exists
{ field: { $exists: false } }  // Field doesn't exist

// Pattern matching
{ field: { $regex: 'pattern' } }  // Regex match

// Logical operators
{ $and: [filter1, filter2] }  // All conditions must match
{ $or: [filter1, filter2] }   // Any condition can match
```

### Query Options

```typescript
interface QueryOptions {
  /** Maximum results to return */
  limit?: number

  /** Number of results to skip */
  offset?: number

  /** Sort order: 'field' (asc) or '-field' (desc) */
  sort?: string
}

// Examples
const recent = await users.find({}, { limit: 10, sort: '-createdAt' })
const page2 = await users.find({}, { limit: 20, offset: 20 })
```

### Collection Methods

```typescript
interface RemoteCollection<T> {
  get(id: string): Promise<T | null>
  put(id: string, value: T): Promise<void>
  delete(id: string): Promise<void>
  has(id: string): Promise<boolean>
  find(filter?: Filter<T>, options?: QueryOptions): Promise<T[]>
  count(filter?: Filter<T>): Promise<number>
  list(options?: QueryOptions): Promise<T[]>
  keys(): Promise<string[]>
  clear(): Promise<void>
}
```

## Schema Introspection

Get the RPC schema and database structure:

```typescript
const $ = RPC('https://my-do.workers.dev')

// Full RPC schema
const schema = await $.schema()
// {
//   version: 1,
//   methods: [{ name: 'createUser', path: 'createUser', params: 2 }],
//   namespaces: [{ name: 'admin', methods: [...] }],
//   database: { tables: [...] },
// }

// Database schema only
const dbSchema = await $.dbSchema()
// {
//   tables: [
//     {
//       name: 'users',
//       columns: [{ name: 'id', type: 'TEXT', ... }],
//       indexes: [...],
//     }
//   ]
// }
```

### Schema Types

```typescript
interface RpcSchema {
  version: number
  methods: RpcMethodSchema[]
  namespaces: RpcNamespaceSchema[]
  database?: DatabaseSchema
  colo?: string
}

interface DatabaseSchema {
  tables: TableSchema[]
}

interface TableSchema {
  name: string
  columns: ColumnSchema[]
  indexes: IndexSchema[]
}
```

## Type Safety

Use typed collections and SQL queries:

```typescript
interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  active: boolean
}

const $ = RPC<{
  createUser: (data: Omit<User, 'id'>) => Promise<User>
}>('https://my-do.workers.dev')

// Typed SQL
const users = await $.sql<User>`SELECT * FROM users`.all()
// users is User[]

// Typed collection
const user = await $.collection<User>('users').get('user-1')
// user is User | null
```
