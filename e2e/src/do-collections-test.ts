/**
 * E2E Test DO for DOCollections
 *
 * Tests the REAL DOCollections implementation using vitest-pool-workers.
 */

import { DurableRPC } from '../../core/src/index.js'
import { DOCollections, type SemanticMatcher, type SemanticMatch, type Thing } from '../../core/src/do-collections.js'

// ============================================================================
// Mock Semantic Matcher for testing fuzzy relationships
// ============================================================================

/**
 * Simple semantic matcher for testing that uses string similarity
 * In production, this would use real embeddings
 */
export class TestSemanticMatcher implements SemanticMatcher {
  private things: Map<string, Thing[]> = new Map()

  register<T>(type: string, thing: Thing<T>) {
    if (!this.things.has(type)) {
      this.things.set(type, [])
    }
    this.things.get(type)!.push(thing as Thing)
  }

  async findSimilar<T = Record<string, unknown>>(
    type: string,
    text: string,
    threshold: number
  ): Promise<SemanticMatch<T>[]> {
    const typedThings = this.things.get(type) || []
    const results: SemanticMatch<T>[] = []

    for (const thing of typedThings) {
      // Simple string similarity based on common words
      const thingText = JSON.stringify(thing.data).toLowerCase()
      const searchText = text.toLowerCase()
      const similarity = this.calculateSimilarity(searchText, thingText)

      if (similarity >= threshold) {
        results.push({
          thing: thing as Thing<T>,
          similarity,
        })
      }
    }

    // Sort by similarity descending
    return results.sort((a, b) => b.similarity - a.similarity)
  }

  private calculateSimilarity(a: string, b: string): number {
    // Simple word overlap similarity
    const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2))
    const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2))

    if (wordsA.size === 0 || wordsB.size === 0) return 0

    let matches = 0
    for (const word of wordsA) {
      if (wordsB.has(word)) matches++
    }

    return matches / Math.max(wordsA.size, wordsB.size)
  }
}

// ============================================================================
// DOCollectionsTestDO
// ============================================================================

export class DOCollectionsTestDO extends DurableRPC {
  private _db?: DOCollections
  private _matcher = new TestSemanticMatcher()

  get db(): DOCollections {
    if (!this._db) {
      this._db = new DOCollections(this.sql, {
        semanticMatcher: this._matcher,
        defaultThreshold: 0.5,
      })
    }
    return this._db
  }

  get matcher(): TestSemanticMatcher {
    return this._matcher
  }

  // ============================================================================
  // Nouns
  // ============================================================================

  defineNoun(name: string, description?: string, schema?: Record<string, unknown>) {
    return this.db.nouns.define(name, { description, schema })
  }

  getNoun(name: string) {
    return this.db.nouns.get(name)
  }

  listNouns() {
    return this.db.nouns.list()
  }

  hasNoun(name: string) {
    return this.db.nouns.has(name)
  }

  // ============================================================================
  // Verbs
  // ============================================================================

  defineVerb(name: string, opts?: {
    description?: string
    cascade?: '->' | '~>' | '<-' | '<~'
    from?: string[]
    to?: string[]
  }) {
    return this.db.verbs.define(name, opts)
  }

  getVerb(name: string) {
    return this.db.verbs.get(name)
  }

  listVerbs() {
    return this.db.verbs.list()
  }

  hasVerb(name: string) {
    return this.db.verbs.has(name)
  }

  // ============================================================================
  // Things
  // ============================================================================

  createThing<T = Record<string, unknown>>(type: string, data: T, id?: string) {
    const thing = this.db.things.create(type, data, id)
    // Register with semantic matcher for fuzzy matching tests
    this._matcher.register(type, thing)
    return thing
  }

  getThing<T = Record<string, unknown>>(id: string) {
    return this.db.things.get<T>(id)
  }

  updateThing<T = Record<string, unknown>>(id: string, data: Partial<T>) {
    return this.db.things.update<T>(id, data)
  }

  deleteThing(id: string) {
    return this.db.things.delete(id)
  }

  findThings<T = Record<string, unknown>>(type?: string, filter?: Record<string, unknown>) {
    return this.db.things.find<T>(type, filter as any)
  }

  countThings(type?: string) {
    return this.db.things.count(type)
  }

  listThings(options?: { limit?: number; offset?: number; sort?: string }) {
    return this.db.things.list(options)
  }

  // ============================================================================
  // Actions
  // ============================================================================

  logAction(verb: string, from?: string, to?: string, data?: Record<string, unknown>, by?: string) {
    return this.db.actions.log(verb, from, to, data, by)
  }

  getAction(id: string) {
    return this.db.actions.get(id)
  }

  findActions(filter?: Record<string, unknown>) {
    return this.db.actions.find(filter as any)
  }

  actionsForThing(thingId: string) {
    return this.db.actions.forThing(thingId)
  }

  countActions(filter?: Record<string, unknown>) {
    return this.db.actions.count(filter as any)
  }

  // ============================================================================
  // Relationships
  // ============================================================================

  relate(from: string, verb: string, to: string, opts?: {
    cascade?: '->' | '~>' | '<-' | '<~'
    data?: Record<string, unknown>
  }) {
    return this.db.relate(from, verb, to, opts)
  }

  unrelate(from: string, verb: string, to: string) {
    return this.db.unrelate(from, verb, to)
  }

  relationsFrom(from: string, verb?: string) {
    return this.db.relationsFrom(from, verb)
  }

  relationsTo(to: string, verb?: string) {
    return this.db.relationsTo(to, verb)
  }

  traverse<T = Record<string, unknown>>(from: string, verb: string) {
    return this.db.traverse<T>(from, verb)
  }

  traverseBack<T = Record<string, unknown>>(to: string, verb: string) {
    return this.db.traverseBack<T>(to, verb)
  }

  // ============================================================================
  // Fuzzy Relate
  // ============================================================================

  async fuzzyRelate<T = Record<string, unknown>>(
    from: string,
    verb: string,
    targetType: string,
    text: string,
    createData?: T,
    opts?: { threshold?: number }
  ) {
    const result = await this.db.fuzzyRelate<T>(from, verb, targetType, text, createData, opts)
    // Register newly created things with matcher
    if (result.created) {
      this._matcher.register(targetType, result.thing)
    }
    return result
  }

  // ============================================================================
  // Stats
  // ============================================================================

  stats() {
    return this.db.stats()
  }
}

// ============================================================================
// Env
// ============================================================================

export interface DOCollectionsEnv {
  DO_COLL_TEST: DurableObjectNamespace<DOCollectionsTestDO>
}
