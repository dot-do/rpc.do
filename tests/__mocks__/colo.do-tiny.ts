/**
 * Mock for colo.do/tiny optional peer dependency
 * Used in tests when the actual package is not installed
 */

export interface ColoInfo {
  city: string
  country: string
  lat: number
  lon: number
}

const colos: Record<string, ColoInfo> = {
  'SFO': { city: 'San Francisco', country: 'US', lat: 37.6213, lon: -122.379 },
  'LAX': { city: 'Los Angeles', country: 'US', lat: 33.9425, lon: -118.408 },
  'DFW': { city: 'Dallas', country: 'US', lat: 32.8998, lon: -97.0403 },
  'IAD': { city: 'Washington', country: 'US', lat: 38.9531, lon: -77.4565 },
}

const distances: Record<string, number> = {
  'SFO-LAX': 543,
  'SFO-DFW': 2370,
  'SFO-IAD': 3923,
  'LAX-DFW': 1992,
  'LAX-IAD': 3703,
  'DFW-IAD': 1930,
}

const latencies: Record<string, number> = {
  'SFO-LAX': 10,
  'SFO-DFW': 35,
  'SFO-IAD': 60,
  'LAX-DFW': 30,
  'LAX-IAD': 55,
  'DFW-IAD': 30,
}

export function getColo(code: string): ColoInfo | undefined {
  return colos[code]
}

export function coloDistance(from: string, to: string): number | undefined {
  if (from === to) return 0
  const key1 = `${from}-${to}`
  const key2 = `${to}-${from}`
  return distances[key1] ?? distances[key2]
}

export function estimateLatency(from: string, to: string): number | undefined {
  if (from === to) return 0
  const key1 = `${from}-${to}`
  const key2 = `${to}-${from}`
  return latencies[key1] ?? latencies[key2]
}

export function nearestColo(from: string, candidates: string[]): string | undefined {
  if (candidates.length === 0) return undefined
  // SFO is closest to LAX
  if (from === 'SFO' && candidates.includes('LAX')) return 'LAX'
  // LAX is closest to SFO
  if (from === 'LAX' && candidates.includes('SFO')) return 'SFO'
  return candidates[0]
}

export function sortByDistance(from: string, colos?: string[]): Array<{ colo: string; distance: number; latency: number }> {
  const defaultColos = ['LAX', 'DFW', 'IAD']
  const targets = colos ?? defaultColos

  return targets.map(colo => {
    const distance = coloDistance(from, colo) ?? 9999
    const latency = estimateLatency(from, colo) ?? 999
    return { colo, distance, latency }
  }).sort((a, b) => a.distance - b.distance)
}
