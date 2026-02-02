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

import { createCollection, type Collection, type Filter, type QueryOptions } from '@dotdo/collections'

// ============================================================================
// Semantic Matching
// ============================================================================

/**
 * Semantic match result
 */
export interface SemanticMatch<T = Record<string, unknown>> {
  thing: Thing<T>
  similarity: number
}

/**
 * Semantic matcher interface - implement to enable fuzzy (~>) relationships
 *
 * @example
 * ```typescript
 * const matcher: SemanticMatcher = {
 *   async findSimilar(type, text, threshold) {
 *     const embedding = await ai.embed(text)
 *     return vectorStore.search(type, embedding, threshold)
 *   }
 * }
 * ```
 */
export interface SemanticMatcher {
  /**
   * Find things similar to the given text/data
   * @param type - Thing type to search
   * @param text - Text to match against
   * @param threshold - Minimum similarity (0-1)
   * @returns Matches sorted by similarity (highest first)
   */
  findSimilar<T = Record<string, unknown>>(
    type: string,
    text: string,
    threshold: number
  ): Promise<SemanticMatch<T>[]>
}

// ============================================================================
// Types
// ============================================================================

/**
 * Cascade operators for relationships
 *
 * - `->` : Direct reference (exact match required)
 * - `~>` : Fuzzy/semantic reference (find closest via embedding, create if none close)
 * - `<-` : Direct back-reference
 * - `<~` : Fuzzy/semantic back-reference
 */
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
  /**
   * Cascade operator:
   * - `->` direct (exact match)
   * - `~>` fuzzy (semantic match, create if none close)
   * - `<-` direct back-ref
   * - `<~` fuzzy back-ref
   */
  cascade?: CascadeOperator
  /** Valid source types */
  from?: string[]
  /** Valid target types */
  to?: string[]
  /** Similarity threshold for fuzzy matching (0-1, default 0.8) */
  threshold?: number
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

/**
 * Custom epoch for ID generation (2024-01-01T00:00:00.000Z).
 * Using a custom epoch reduces ID length by omitting the leading digits
 * that would be the same for all IDs generated in this era.
 */
const EPOCH_2024 = 1704067200000

/** Generate a sortable, collision-resistant ID.
 *
 * Uses a base-36 timestamp prefix (milliseconds since EPOCH_2024) for
 * chronological sortability, followed by a crypto.randomUUID() suffix
 * for uniqueness. This avoids the shared module-level counter that could
 * drift across Durable Object instances sharing the same isolate and
 * replaces the weak 4-character Math.random() suffix (~1.6M possibilities)
 * with a full 128-bit UUID (>3.4 x 10^38 possibilities).
 */
function generateId(prefix?: string): string {
  const now = Date.now() - EPOCH_2024
  const uuid = crypto.randomUUID().replace(/-/g, '')
  const id = `${now.toString(36)}${uuid}`
  return prefix ? `${prefix}_${id}` : id
}

// ============================================================================
// Internal Storage Types
// ============================================================================

/**
 * Internal storage format for Things.
 * Uses _prefixed field names because @dotdo/collections doesn't allow
 * $-prefixed field names in filters.
 */
interface StoredThing {
  _id: string
  _type: string
  _version: number
  _createdAt: number
  _updatedAt: number
  data: Record<string, unknown>
}

/** Convert Thing to internal storage format */
function toStoredThing<T extends Record<string, unknown>>(thing: Thing<T>): StoredThing {
  return {
    _id: thing.$id,
    _type: thing.$type,
    _version: thing.$version,
    _createdAt: thing.$createdAt,
    _updatedAt: thing.$updatedAt,
    data: thing.data,
  }
}

/** Convert internal storage format to Thing */
function fromStoredThing<T extends Record<string, unknown>>(stored: StoredThing): Thing<T> {
  return {
    $id: stored._id,
    $type: stored._type,
    $version: stored._version,
    $createdAt: stored._createdAt,
    $updatedAt: stored._updatedAt,
    data: stored.data as T,
  }
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
export interface DOCollectionsOptions {
  /** Semantic matcher for fuzzy (~>) relationships */
  semanticMatcher?: SemanticMatcher
  /** Default similarity threshold for fuzzy matching (0-1, default 0.8) */
  defaultThreshold?: number
}

export class DOCollections {
  private sql: SqlStorage
  private _nouns: Collection<Noun>
  private _verbs: Collection<Verb>
  private _things: Collection<StoredThing>
  private _actions: Collection<Action>
  private _rels: Collection<Relationship>
  private _matcher?: SemanticMatcher
  private _threshold: number

  constructor(sql: SqlStorage, options?: DOCollectionsOptions) {
    this.sql = sql
    this._nouns = createCollection<Noun>(sql, '_nouns')
    this._verbs = createCollection<Verb>(sql, '_verbs')
    this._things = createCollection<StoredThing>(sql, '_things')
    this._actions = createCollection<Action>(sql, '_actions')
    this._rels = createCollection<Relationship>(sql, '_rels')
    if (options?.semanticMatcher) this._matcher = options.semanticMatcher
    this._threshold = options?.defaultThreshold ?? 0.8
  }

  // --------------------------------------------------------------------------
  // Nouns (Type Definitions)
  // --------------------------------------------------------------------------

  nouns = {
    /** Define a new noun (type) */
    define: (name: string, opts?: { description?: string; schema?: Record<string, unknown> }): Noun => {
      const noun: Noun = {
        name,
        $createdAt: Date.now(),
      }
      if (opts?.description !== undefined) noun.description = opts.description
      if (opts?.schema !== undefined) noun.schema = opts.schema
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
        $createdAt: Date.now(),
      }
      if (opts?.description !== undefined) verb.description = opts.description
      if (opts?.cascade !== undefined) verb.cascade = opts.cascade
      if (opts?.from !== undefined) verb.from = opts.from
      if (opts?.to !== undefined) verb.to = opts.to
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
    create: <T extends Record<string, unknown> = Record<string, unknown>>(type: string, data: T, id?: string): Thing<T> => {
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
      // Store using internal format with _prefixed fields
      this._things.put($id, toStoredThing(thing))
      this._logAction('created', undefined, $id)
      return thing
    },

    /** Get a thing by ID */
    get: <T extends Record<string, unknown> = Record<string, unknown>>(id: string): Thing<T> | null => {
      const stored = this._things.get(id)
      return stored ? fromStoredThing<T>(stored) : null
    },

    /** Update a thing (increments version) */
    update: <T extends Record<string, unknown> = Record<string, unknown>>(id: string, data: Partial<T>): Thing<T> | null => {
      const stored = this._things.get(id)
      if (!stored) return null

      const updated: Thing<T> = {
        $id: stored._id,
        $type: stored._type,
        $version: stored._version + 1,
        $createdAt: stored._createdAt,
        $updatedAt: Date.now(),
        data: { ...stored.data, ...data } as T,
      }
      this._things.put(id, toStoredThing(updated))
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
    find: <T extends Record<string, unknown> = Record<string, unknown>>(type?: string, filter?: Filter<T>, options?: QueryOptions): Thing<T>[] => {
      // Use _type internally (collections doesn't allow $ prefix in field names)
      const baseFilter: Filter<StoredThing> = type ? { _type: type } as Filter<StoredThing> : {}
      // Merge data filters
      const fullFilter = filter
        ? { ...baseFilter, ...Object.fromEntries(Object.entries(filter).map(([k, v]) => [`data.${k}`, v])) }
        : baseFilter
      return this._things.find(fullFilter as Filter<StoredThing>, options).map(s => fromStoredThing<T>(s))
    },

    /** Count things by type */
    count: (type?: string): number => {
      // Use _type internally (collections doesn't allow $ prefix in field names)
      return type
        ? this._things.count({ _type: type } as Filter<StoredThing>)
        : this._things.count()
    },

    /** List all things */
    list: (options?: QueryOptions): Thing[] => this._things.list(options).map(s => fromStoredThing(s)),
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
      $createdAt: Date.now(),
    }
    if (opts?.data !== undefined) rel.data = opts.data
    this._rels.put($id, rel)
    this._logAction(verb, from, to, opts?.data)
    return rel
  }

  /**
   * Fuzzy relate - find or create a semantic match
   *
   * Uses ~> operator semantics:
   * 1. Search for semantically similar things
   * 2. If found above threshold, relate to the closest match
   * 3. If not found, create a new thing and relate to it
   *
   * @param from - Source thing ID
   * @param verb - Relationship type
   * @param targetType - Type of thing to find/create
   * @param text - Text to match semantically
   * @param createData - Data to use if creating new thing
   * @returns The target thing (found or created) and the relationship
   */
  async fuzzyRelate<T extends Record<string, unknown> = Record<string, unknown>>(
    from: string,
    verb: string,
    targetType: string,
    text: string,
    createData?: T,
    opts?: { threshold?: number }
  ): Promise<{ thing: Thing<T>; relationship: Relationship; created: boolean }> {
    if (!this._matcher) {
      throw new Error('Semantic matcher not configured. Pass semanticMatcher in DOCollections options.')
    }

    const threshold = opts?.threshold ?? this._threshold
    const matches = await this._matcher.findSimilar<T>(targetType, text, threshold)

    let thing: Thing<T>
    let created = false

    const topMatch = matches[0]
    if (topMatch && topMatch.similarity >= threshold) {
      // Found a close match
      thing = topMatch.thing
    } else {
      // Create new thing
      thing = this.things.create<T>(targetType, createData ?? ({ text } as unknown as T))
      created = true
    }

    const relationship = this.relate(from, verb, thing.$id, { cascade: '~>' })

    return { thing, relationship, created }
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
  traverse<T extends Record<string, unknown> = Record<string, unknown>>(from: string, verb: string): Thing<T>[] {
    const rels = this.relationsFrom(from, verb)
    return rels
      .map(r => this.things.get<T>(r.to))
      .filter((t): t is Thing<T> => t !== null)
  }

  /**
   * Reverse traverse (incoming relationships)
   */
  traverseBack<T extends Record<string, unknown> = Record<string, unknown>>(to: string, verb: string): Thing<T>[] {
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
      $at: Date.now(),
    }
    if (from !== undefined) action.from = from
    if (to !== undefined) action.to = to
    if (data !== undefined) action.data = data
    if (by !== undefined) action.$by = by
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
