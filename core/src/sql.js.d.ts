/**
 * Type declarations for sql.js
 * Used in tests to simulate Cloudflare Workers SQLite API
 */
declare module 'sql.js' {
  export interface Statement {
    bind(params?: unknown[]): boolean
    step(): boolean
    getAsObject(): Record<string, unknown>
    free(): void
  }

  export interface Database {
    run(sql: string, params?: unknown[]): Database
    exec(sql: string, params?: unknown[]): QueryExecResult[]
    prepare(sql: string): Statement
    getRowsModified(): number
    create_function(name: string, fn: (...args: any[]) => unknown): void
    close(): void
  }

  export interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database
  }

  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string
  }): Promise<SqlJsStatic>
}
