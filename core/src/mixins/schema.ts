/**
 * Schema Mixin
 *
 * Provides schema introspection for RPC methods, namespaces, and database.
 * Used for typed client generation and API discovery.
 */

import type { AbstractConstructor, HasSQL } from './types.js'
import {
  introspectDatabase,
  introspectDurableRPC,
  type RpcSchema,
  type DatabaseSchema,
  type IntrospectableRpc,
} from '../introspection.js'

/**
 * Interface provided by the Schema mixin
 */
export interface SchemaMixin {
  getSchema(): RpcSchema
  __dbSchema(): DatabaseSchema
}

/**
 * Configuration for the schema mixin
 */
export interface SchemaConfig {
  /** Properties to skip during introspection */
  skipProps: Set<string>
  /** The base prototype to stop at */
  basePrototype: object
}

/**
 * Interface for classes that can be introspected for schema
 */
interface SchemaIntrospectable {
  readonly sql: SqlStorage
  readonly colo?: string | undefined
}

/**
 * Schema mixin that adds introspection capabilities.
 *
 * @example
 * ```typescript
 * class MyDO extends withSchema(DurableRPCBase, {
 *   skipProps: SKIP_PROPS_EXTENDED,
 *   basePrototype: DurableRPC.prototype
 * }) {
 *   // Now has getSchema() and __dbSchema() methods
 * }
 * ```
 */
export function withSchema<T extends AbstractConstructor<SchemaIntrospectable>>(
  Base: T,
  config: SchemaConfig
) {
  abstract class SchemaMixinClass extends Base implements SchemaMixin {
    /**
     * Introspect this DO's API and return a complete schema description
     *
     * Returns a schema containing:
     * - All public RPC methods with parameter counts
     * - Nested namespaces and their methods
     * - Database schema (tables, columns, indexes)
     * - Current colo (datacenter location)
     *
     * This is used by:
     * - `npx rpc.do generate` for typed client codegen
     * - GET requests to `/__schema` endpoint
     * - API documentation and tooling
     *
     * @returns Complete RPC schema for this Durable Object
     */
    getSchema(): RpcSchema {
      // Cast to IntrospectableRpc - safe because we have sql and colo properties
      const instance = this as unknown as IntrospectableRpc
      return introspectDurableRPC(instance, {
        skipProps: config.skipProps,
        basePrototype: config.basePrototype,
      })
    }

    /**
     * Get database schema (tables, columns, indexes)
     * @internal
     */
    __dbSchema(): DatabaseSchema {
      return introspectDatabase(this.sql)
    }
  }

  return SchemaMixinClass
}

// Re-export schema types
export type { RpcSchema, DatabaseSchema }
