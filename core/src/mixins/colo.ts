/**
 * Colo Mixin
 *
 * Provides colocation (datacenter) awareness for globally distributed DOs.
 * Enables latency estimation, distance calculation, and optimal routing.
 */

import type { AbstractConstructor } from './types.js'
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
 * Colo (colocation) context for location-aware DOs
 */
export interface ColoContext {
  /** The colo where this DO instance is running */
  colo: string
  /** Full colo information (city, country, coordinates, etc.) */
  info?: ColoInfo
  /** The colo of the worker that made this request (if known) */
  workerColo?: string
  /** Estimated latency from worker to DO in milliseconds */
  latencyMs?: number
  /** Distance from worker to DO in kilometers */
  distanceKm?: number
}

/**
 * Interface provided by the Colo mixin
 */
export interface ColoMixin {
  /** Cached colo for this DO instance */
  _colo: string | null
  /** Get the colo where this DO is running */
  readonly colo: string | undefined
  /** Get full colo information for this DO's location */
  readonly coloInfo: ColoInfo | undefined
  /** Get sorted list of colos by distance from this DO */
  getColosByDistance(colos?: string[]): Array<{ colo: string; distance: number; latency: number }>
  /** Find the nearest colo from a list of candidates */
  findNearestColo(candidates: string[]): string | undefined
  /** Estimate latency to another colo from this DO's location */
  estimateLatencyTo(targetColo: string): number | undefined
  /** Get distance to another colo from this DO's location */
  distanceTo(targetColo: string): number | undefined
}

/**
 * Base interface for colo mixin - requires access to current request
 */
interface ColoMixinBase {
  _currentRequest?: Request
}

/**
 * Colo mixin that adds location awareness capabilities.
 *
 * @example
 * ```typescript
 * class MyDO extends withColo(DurableRPCBase) {
 *   async getLatencyInfo() {
 *     return {
 *       currentColo: this.colo,
 *       latencyToSFO: this.estimateLatencyTo('SFO'),
 *       nearestReplica: this.findNearestColo(['SFO', 'DFW', 'IAD'])
 *     }
 *   }
 * }
 * ```
 */
export function withColo<T extends AbstractConstructor<ColoMixinBase>>(Base: T) {
  abstract class ColoMixinClass extends Base implements ColoMixin {
    /** Cached colo for this DO instance */
    _colo: string | null = null

    /**
     * Get the colo where this DO is running
     * Detected from first request, undefined before any requests
     */
    get colo(): string | undefined {
      return this._colo ?? undefined
    }

    /**
     * Get full colo information for this DO's location
     */
    get coloInfo(): ColoInfo | undefined {
      return this._colo ? getColo(this._colo) : undefined
    }

    /**
     * Get sorted list of colos by distance from this DO
     *
     * @param colos - Optional list of colos to sort (defaults to all DO-capable colos)
     * @returns Sorted array of { colo, distance, latency } objects
     */
    getColosByDistance(colos?: string[]): Array<{ colo: string; distance: number; latency: number }> {
      if (!this._colo) return []
      return sortByDistance(this._colo, colos)
    }

    /**
     * Find the nearest colo from a list of candidates
     *
     * @param candidates - List of candidate colo IATA codes
     * @returns Nearest colo, or first candidate if this DO's colo is unknown
     */
    findNearestColo(candidates: string[]): string | undefined {
      if (!this._colo) return candidates[0]
      return nearestColo(this._colo, candidates)
    }

    /**
     * Estimate latency to another colo from this DO's location
     *
     * @param targetColo - Target colo IATA code
     * @returns Estimated round-trip latency in milliseconds
     */
    estimateLatencyTo(targetColo: string): number | undefined {
      if (!this._colo) return undefined
      return estimateLatency(this._colo, targetColo)
    }

    /**
     * Get distance to another colo from this DO's location
     *
     * @param targetColo - Target colo IATA code
     * @returns Distance in kilometers
     */
    distanceTo(targetColo: string): number | undefined {
      if (!this._colo) return undefined
      return coloDistance(this._colo, targetColo)
    }

    /**
     * Build colo context from current request.
     * Utility for building RpcContext.
     */
    protected buildColoContext(): ColoContext {
      const workerColo = this._currentRequest?.headers.get(WORKER_COLO_HEADER) ?? undefined
      const colo = this._colo ?? 'UNKNOWN'
      const info = getColo(colo)
      const latencyMs = workerColo && this._colo ? estimateLatency(workerColo, this._colo) : undefined
      const distanceKm = workerColo && this._colo ? coloDistance(workerColo, this._colo) : undefined

      const coloContext: ColoContext = { colo }
      if (info) coloContext.info = info
      if (workerColo) coloContext.workerColo = workerColo
      if (latencyMs !== undefined) coloContext.latencyMs = latencyMs
      if (distanceKm !== undefined) coloContext.distanceKm = distanceKm

      return coloContext
    }

    /**
     * Detect colo from cf object on request.
     * Call this in onFetch() to enable colo detection.
     */
    protected detectColo(request: Request): void {
      if (!this._colo) {
        const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
        this._colo = cf?.colo ?? null
      }
    }
  }

  return ColoMixinClass
}

// Re-export colo types
export type { ColoInfo }
