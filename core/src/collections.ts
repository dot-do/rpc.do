/**
 * Collections - MongoDB-style document store on DO SQLite
 *
 * Re-exports from @dotdo/collections package.
 *
 * @example
 * ```typescript
 * // Inside DO
 * export class MyDO extends DurableRPC {
 *   users = this.collection<User>('users')
 *
 *   async createUser(data: User) {
 *     await this.users.put(data.id, data)
 *   }
 *
 *   async getActiveUsers() {
 *     return this.users.find({ active: true, role: 'admin' })
 *   }
 * }
 *
 * // Outside DO (via RPC)
 * const users = await $.users.find({ active: true })
 * ```
 *
 * @packageDocumentation
 */

// Re-export everything from @dotdo/collections
export * from '@dotdo/collections'
