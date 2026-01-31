/**
 * Type declarations for colo.do package
 * This file stubs the types until colo.do is published to npm
 */

declare module 'colo.do/tiny' {
  export interface ColoInfo {
    iata: string
    city: string
    country: string
    lat: number
    lon: number
    region?: string
    timezone?: string
  }

  export type ColoRegion = 'WNAM' | 'ENAM' | 'SAM' | 'WEU' | 'EEU' | 'APAC' | 'OC' | 'ME' | 'AFR'

  export function getColo(iata: string): ColoInfo | undefined
  export function getAllColos(): ColoInfo[]
  export function coloDistance(from: string, to: string): number
  export function estimateLatency(from: string, to: string): number
  export function nearestColo(from: string, candidates: string[]): string | undefined
  export function sortByDistance(from: string, colos?: string[]): Array<{ colo: string; distance: number; latency: number }>
}
