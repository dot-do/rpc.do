/**
 * Mixin Types
 *
 * Type definitions for the mixin pattern used in DurableRPC.
 */

/**
 * Constructor type for class mixins.
 * Represents any class constructor that can be extended.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T

/**
 * Abstract constructor type for abstract class mixins.
 * Represents any abstract class constructor that can be extended.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AbstractConstructor<T = object> = abstract new (...args: any[]) => T

/**
 * Combined constructor type that works with both regular and abstract classes.
 */
export type AnyConstructor<T = object> = Constructor<T> | AbstractConstructor<T>

/**
 * Minimal interface for classes that have SQL access.
 * Required by SQL-related mixins.
 */
export interface HasSQL {
  readonly sql: SqlStorage
}

/**
 * Minimal interface for classes that have storage access.
 * Required by storage-related mixins.
 */
export interface HasStorage {
  readonly storage: DurableObjectStorage
}

/**
 * Minimal interface for classes with DO state access.
 * Required by mixins that need full DO state.
 */
export interface HasState {
  readonly ctx: DurableObjectState
}

/**
 * Combined interface for SQL and storage access.
 */
export interface HasSQLAndStorage extends HasSQL, HasStorage {}
