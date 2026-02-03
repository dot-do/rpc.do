/**
 * Colo Plugin
 *
 * Adds colocation (datacenter) awareness to composed DurableRPC instances.
 * Provides $.colo, $.coloInfo, and location-based utility methods.
 *
 * @example
 * ```typescript
 * const myDO = createDurableRPC({
 *   plugins: [coloPlugin()],
 *   methods: {
 *     getLocation: async ($) => ({
 *       colo: $.colo,
 *       info: $.coloInfo,
 *     }),
 *     findNearestReplica: async ($, candidates: string[]) => {
 *       return $.findNearestColo(candidates)
 *     },
 *   }
 * })
 * ```
 */

import type { Plugin, PluginInitContext, PluginRuntimeContext, ColoContext } from '../types.js'
import {
  getColo,
  coloDistance,
  estimateLatency,
  nearestColo,
  sortByDistance,
  type ColoInfo,
} from 'colo.do/tiny'

/** Header used to pass worker colo to DO */
export const WORKER_COLO_HEADER = 'X-Worker-Colo'

/**
 * Colo Plugin options
 */
export interface ColoPluginOptions {
  /** Enable location logging (default: false) */
  logging?: boolean
  /** Custom log function */
  log?: (message: string) => void
}

/**
 * Creates a Colo plugin that adds location awareness capabilities.
 *
 * @param options - Plugin configuration options
 * @returns Colo plugin instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const myDO = createDurableRPC({
 *   plugins: [coloPlugin()],
 *   methods: {
 *     whereAmI: async ($) => $.colo,
 *   }
 * })
 *
 * // With logging
 * const myDO = createDurableRPC({
 *   plugins: [coloPlugin({ logging: true })],
 *   methods: { ... }
 * })
 * ```
 */
export function coloPlugin(options: ColoPluginOptions = {}): Plugin<ColoContext> {
  const { logging = false, log = console.log } = options

  // Cached colo (detected on first request)
  let cachedColo: string | null = null

  return {
    name: 'colo',

    init(_ctx: PluginInitContext): ColoContext {
      return {
        get colo(): string | undefined {
          return cachedColo ?? undefined
        },

        get coloInfo(): ColoInfo | undefined {
          return cachedColo ? getColo(cachedColo) : undefined
        },

        estimateLatencyTo(targetColo: string): number | undefined {
          if (!cachedColo) return undefined
          return estimateLatency(cachedColo, targetColo)
        },

        distanceTo(targetColo: string): number | undefined {
          if (!cachedColo) return undefined
          return coloDistance(cachedColo, targetColo)
        },

        findNearestColo(candidates: string[]): string | undefined {
          if (!cachedColo) return candidates[0]
          return nearestColo(cachedColo, candidates)
        },
      }
    },

    // Detect colo from CF object on request
    onFetch(request: Request, _ctx: PluginRuntimeContext & ColoContext): void {
      if (!cachedColo) {
        const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
        cachedColo = cf?.colo ?? null

        if (logging && cachedColo) {
          log(`[Colo] Detected colo: ${cachedColo}`)
        }
      }
    },

    // Additional methods that can be exposed if needed
    methods: {
      /**
       * Get sorted list of colos by distance from this DO
       */
      getColosByDistance(colos?: string[]): Array<{ colo: string; distance: number; latency: number }> {
        if (!cachedColo) return []
        return sortByDistance(cachedColo, colos)
      },
    },

    skipProps: ['colo', 'coloInfo', '_colo'],
  }
}

// Re-export colo types (note: WORKER_COLO_HEADER already exported above)
export type { ColoInfo }
