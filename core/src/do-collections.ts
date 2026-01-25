/**
 * DO Collections - Digital Object semantics on top of base collections
 *
 * Adds:
 * - Nouns (type definitions) -> Things (instances)
 * - Verbs (action definitions) -> Actions (instances)
 * - Relationships with cascade operators (->, ~>, <-, <~)
 * - Type/version tracking ($type, $version)
 *
 * @example
 * ```typescript
 * import { DOCollections } from '@dotdo/rpc/do-collections'
 *
 * export class MyDO extends DurableRPC {
 *   db = new DOCollections(this.sql)
 *
 *   async createUser(data: UserData) {
 *     return this.db.things.create('User', data)
 *   }
 *
 *   async linkUserToOrg(userId: string, orgId: string) {
 *     return this.db.relate(userId, 'memberOf', orgId)
 *   }
 * }
 * ```
 */

import { createCollection, type Collection, type Filter, type QueryOptions } from './collections.js'

// ============================================================================
// Types
// ============================================================================

/** Cascade operators for relationships */
export type CascadeOperator = '->' | '~>' | '<-' | '<~'

/** Base entity with DO identity */
export interface DOEntity {
  $id: string
  $type: string
  $version: number
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

/** Noun - defines a type of Thing */
export interface Noun {
  name: string
  description?: string
  schema?: Record<string, unknown>
  $createdAt: number
  [key: string]: unknown
}

/** Verb - defines a type of Action/Relationship */
export interface Verb {
  name: string
  description?: string
  /** Cascade operator: -> sync, ~> async, <- back-ref, <~ async back-ref */
  cascade?: CascadeOperator
  /** Valid source types */
  from?: string[]
  /** Valid target types */
  to?: string[]
  $createdAt: number
  [key: string]: unknown
}

/** Thing - an instance of a Noun */
export interface Thing<T = Record<string, unknown>> extends DOEntity {
  data: T
}

/** Action - an instance of a Verb (event/relationship) */
export interface Action {
  $id: string
  verb: string
  from?: string
  to?: string
  data?: Record<string, unknown>
  $at: number
  $by?: string
  [key: string]: unknown
}

/** Relationship - edge in the graph */
export interface Relationship {
  $id: string
  from: string
  verb: string
  to: string
  cascade: CascadeOperator
  data?: Record<string, unknown>
  $createdAt: number
  [key: string]: unknown
}

// ============================================================================
// ID Generation
// ============================================================================

let counter = 0
const epoch = 1704067200000 // 2024-01-01

/** Generate a short, sortable ID */
function generateId(prefix?: string): string {
  const now = Date.now() - epoch
  const c = (counter++ % 1000).toString().padStart(3, '0')
  const r = Math.random().toString(36).slice(2, 6)
  const id = `${now.toString(36)}${c}${r}`
  return prefix ? `${prefix}_${id}` : id
}

// ============================================================================
// DO Collections
// ============================================================================

/**
 * Digital Object Collections Manager
 *
 * Provides DO-specific semantics on top of base collections:
 * - nouns: Type definitions
 * - verbs: Action/relationship definitions
 * - things: Entity instances with $type, $version
 * - actions: Event log / audit trail
 * - relationships: Graph edges with cascade operators
 */
export class DOCollections {
  private sql: SqlStorage
  private _nouns: Collection<Noun>
  private _verbs: Collection<Verb>
  private _things: Collection<Thing>
  private _actions: Collection<Action>
  private _rels: Collection<Relationship>

  constructor(sql: SqlStorage) {
    this.sql = sql
    this._nouns = createCollection<Noun>(sql, '_nouns')
    this._verbs = createCollection<Verb>(sql, '_verbs')
    this._things = createCollection<Thing>(sql, '_things')
    this._actions = createCollection<Action>(sql, '_actions')
    this._rels = createCollection<Relationship>(sql, '_rels')
  }

  // --------------------------------------------------------------------------
  // Nouns (Type Definitions)
  // --------------------------------------------------------------------------

  nouns = {
    /** Define a new noun (type) */
    define: (name: string, opts?: { description?: string; schema?: Record<string, unknown> }): Noun => {
      const noun: Noun = {
        name,
        description: opts?.description,
        schema: opts?.schema,
        $createdAt: Date.now(),
      }
      this._nouns.put(name, noun)
      return noun
    },

    /** Get a noun by name */
    get: (name: string): Noun | null => this._nouns.get(name),

    /** List all nouns */
    list: (): Noun[] => this._nouns.list(),

    /** Check if noun exists */
    has: (name: string): boolean => this._nouns.has(name),
  }

  // --------------------------------------------------------------------------
  // Verbs (Action/Relationship Definitions)
  // --------------------------------------------------------------------------

  verbs = {
    /** Define a new verb */
    define: (name: string, opts?: {
      description?: string
      cascade?: CascadeOperator
      from?: string[]
      to?: string[]
    }): Verb => {
      const verb: Verb = {
        name,
        description: opts?.description,
        cascade: opts?.cascade,
        from: opts?.from,
        to: opts?.to,
        $createdAt: Date.now(),
      }
      this._verbs.put(name, verb)
      return verb
    },

    /** Get a verb by name */
    get: (name: string): Verb | null => this._verbs.get(name),

    /** List all verbs */
    list: (): Verb[] => this._verbs.list(),

    /** Check if verb exists */
    has: (name: string): boolean => this._verbs.has(name),
  }

  // --------------------------------------------------------------------------
  // Things (Entity Instances)
  // --------------------------------------------------------------------------

  things = {
    /** Create a new thing */
    create: <T = Record<string, unknown>>(type: string, data: T, id?: string): Thing<T> => {
      const $id = id || generateId(type.toLowerCase())
      const now = Date.now()
      const thing: Thing<T> = {
        $id,
        $type: type,
        $version: 1,
        $createdAt: now,
        $updatedAt: now,
        data,
      }
      this._things.put($id, thing as Thing)
      this._logAction('created', undefined, $id)
      return thing
    },

    /** Get a thing by ID */
    get: <T = Record<string, unknown>>(id: string): Thing<T> | null => {
      return this._things.get(id) as Thing<T> | null
    },

    /** Update a thing (increments version) */
    update: <T = Record<string, unknown>>(id: string, data: Partial<T>): Thing<T> | null => {
      const existing = this._things.get(id)
      if (!existing) return null

      const updated: Thing<T> = {
        ...existing,
        $version: existing.$version + 1,
        $updatedAt: Date.now(),
        data: { ...existing.data, ...data } as T,
      }
      this._things.put(id, updated as Thing)
      this._logAction('updated', undefined, id)
      return updated
    },

    /** Delete a thing */
    delete: (id: string): boolean => {
      const deleted = this._things.delete(id)
      if (deleted) {
        this._logAction('deleted', undefined, id)
        // Clean up relationships
        this._rels.find({ from: id } as Filter<Relationship>).forEach(r => this._rels.delete(r.$id))
        this._rels.find({ to: id } as Filter<Relationship>).forEach(r => this._rels.delete(r.$id))
      }
      return deleted
    },

    /** Find things by type and optional filter */
    find: <T = Record<string, unknown>>(type?: string, filter?: Filter<T>, options?: QueryOptions): Thing<T>[] => {
      const baseFilter: Filter<Thing> = type ? { $type: type } as Filter<Thing> : {}
      // Merge data filters
      const fullFilter = filter
        ? { ...baseFilter, ...Object.fromEntries(Object.entries(filter).map(([k, v]) => [`data.${k}`, v])) }
        : baseFilter
      return this._things.find(fullFilter as Filter<Thing>, options) as Thing<T>[]
    },

    /** Count things by type */
    count: (type?: string): number => {
      return type
        ? this._things.count({ $type: type } as Filter<Thing>)
        : this._things.count()
    },

    /** List all things */
    list: (options?: QueryOptions): Thing[] => this._things.list(options),
  }

  // --------------------------------------------------------------------------
  // Actions (Event Log)
  // --------------------------------------------------------------------------

  actions = {
    /** Log an action */
    log: (verb: string, from?: string, to?: string, data?: Record<string, unknown>, by?: string): Action => {
      return this._logAction(verb, from, to, data, by)
    },

    /** Get action by ID */
    get: (id: string): Action | null => this._actions.get(id),

    /** Find actions */
    find: (filter?: Filter<Action>, options?: QueryOptions): Action[] => {
      return this._actions.find(filter, options)
    },

    /** Get actions for a thing */
    forThing: (thingId: string, options?: QueryOptions): Action[] => {
      return this._actions.find(
        { $or: [{ from: thingId }, { to: thingId }] } as Filter<Action>,
        options
      )
    },

    /** Count actions */
    count: (filter?: Filter<Action>): number => this._actions.count(filter),
  }

  // --------------------------------------------------------------------------
  // Relationships (Graph Edges)
  // --------------------------------------------------------------------------

  /**
   * Create a relationship between two things
   *
   * @param from - Source thing ID
   * @param verb - Relationship type
   * @param to - Target thing ID
   * @param cascade - Cascade operator (default: '->')
   */
  relate(from: string, verb: string, to: string, opts?: {
    cascade?: CascadeOperator
    data?: Record<string, unknown>
  }): Relationship {
    const $id = generateId('rel')
    const rel: Relationship = {
      $id,
      from,
      verb,
      to,
      cascade: opts?.cascade || '->',
      data: opts?.data,
      $createdAt: Date.now(),
    }
    this._rels.put($id, rel)
    this._logAction(verb, from, to, opts?.data)
    return rel
  }

  /**
   * Remove a relationship
   */
  unrelate(from: string, verb: string, to: string): boolean {
    const rels = this._rels.find({ from, verb, to } as Filter<Relationship>)
    if (rels.length === 0) return false
    rels.forEach(r => this._rels.delete(r.$id))
    this._logAction(`un${verb}`, from, to)
    return true
  }

  /**
   * Get relationships from a thing
   */
  relationsFrom(from: string, verb?: string): Relationship[] {
    const filter: Filter<Relationship> = verb ? { from, verb } as Filter<Relationship> : { from } as Filter<Relationship>
    return this._rels.find(filter)
  }

  /**
   * Get relationships to a thing
   */
  relationsTo(to: string, verb?: string): Relationship[] {
    const filter: Filter<Relationship> = verb ? { to, verb } as Filter<Relationship> : { to } as Filter<Relationship>
    return this._rels.find(filter)
  }

  /**
   * Traverse relationships (one level)
   *
   * @param from - Starting thing ID
   * @param verb - Relationship type to follow
   * @returns Things connected via the relationship
   */
  traverse<T = Record<string, unknown>>(from: string, verb: string): Thing<T>[] {
    const rels = this.relationsFrom(from, verb)
    return rels
      .map(r => this.things.get<T>(r.to))
      .filter((t): t is Thing<T> => t !== null)
  }

  /**
   * Reverse traverse (incoming relationships)
   */
  traverseBack<T = Record<string, unknown>>(to: string, verb: string): Thing<T>[] {
    const rels = this.relationsTo(to, verb)
    return rels
      .map(r => this.things.get<T>(r.from))
      .filter((t): t is Thing<T> => t !== null)
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private _logAction(verb: string, from?: string, to?: string, data?: Record<string, unknown>, by?: string): Action {
    const action: Action = {
      $id: generateId('act'),
      verb,
      from,
      to,
      data,
      $at: Date.now(),
      $by: by,
    }
    this._actions.put(action.$id, action)
    return action
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  stats(): {
    nouns: number
    verbs: number
    things: number
    actions: number
    relationships: number
  } {
    return {
      nouns: this._nouns.count(),
      verbs: this._verbs.count(),
      things: this._things.count(),
      actions: this._actions.count(),
      relationships: this._rels.count(),
    }
  }
}
