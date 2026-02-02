/**
 * Constants Sync Test
 *
 * Verifies that INTERNAL_METHODS constants stay in sync between
 * the client (src/constants.ts) and server (core/src/constants.ts) packages.
 *
 * These files are intentionally duplicated because the packages have no
 * runtime dependency between them, but they must have identical values
 * for protocol compatibility.
 */

import { describe, it, expect } from 'vitest'
import { INTERNAL_METHODS as CLIENT_METHODS, INTERNAL_METHOD_NAMES as CLIENT_METHOD_NAMES } from './constants'
import { INTERNAL_METHODS as SERVER_METHODS, INTERNAL_METHOD_NAMES as SERVER_METHOD_NAMES } from '../core/src/constants'

describe('Constants Sync', () => {
  it('should have identical INTERNAL_METHODS between client and server packages', () => {
    // Get all keys from both objects
    const clientKeys = Object.keys(CLIENT_METHODS).sort()
    const serverKeys = Object.keys(SERVER_METHODS).sort()

    // Check that both have the same keys
    expect(clientKeys).toEqual(serverKeys)

    // Check that all values match
    for (const key of clientKeys) {
      const clientValue = CLIENT_METHODS[key as keyof typeof CLIENT_METHODS]
      const serverValue = SERVER_METHODS[key as keyof typeof SERVER_METHODS]
      expect(clientValue, `INTERNAL_METHODS.${key} mismatch`).toBe(serverValue)
    }
  })

  it('should have identical INTERNAL_METHOD_NAMES arrays', () => {
    // Sort both arrays for comparison
    const clientNames = [...CLIENT_METHOD_NAMES].sort()
    const serverNames = [...SERVER_METHOD_NAMES].sort()

    expect(clientNames).toEqual(serverNames)
  })

  it('should have all expected SQL methods', () => {
    const sqlMethods = ['SQL', 'SQL_FIRST', 'SQL_RUN']
    for (const method of sqlMethods) {
      expect(CLIENT_METHODS).toHaveProperty(method)
      expect(SERVER_METHODS).toHaveProperty(method)
    }
  })

  it('should have all expected storage methods', () => {
    const storageMethods = [
      'STORAGE_GET',
      'STORAGE_GET_MULTIPLE',
      'STORAGE_PUT',
      'STORAGE_PUT_MULTIPLE',
      'STORAGE_DELETE',
      'STORAGE_DELETE_MULTIPLE',
      'STORAGE_LIST',
      'STORAGE_KEYS'
    ]
    for (const method of storageMethods) {
      expect(CLIENT_METHODS).toHaveProperty(method)
      expect(SERVER_METHODS).toHaveProperty(method)
    }
  })

  it('should have all expected schema methods', () => {
    const schemaMethods = ['DB_SCHEMA', 'SCHEMA']
    for (const method of schemaMethods) {
      expect(CLIENT_METHODS).toHaveProperty(method)
      expect(SERVER_METHODS).toHaveProperty(method)
    }
  })

  it('should have all expected collection methods', () => {
    const collectionMethods = [
      'COLLECTION_GET',
      'COLLECTION_PUT',
      'COLLECTION_DELETE',
      'COLLECTION_HAS',
      'COLLECTION_FIND',
      'COLLECTION_COUNT',
      'COLLECTION_LIST',
      'COLLECTION_KEYS',
      'COLLECTION_CLEAR',
      'COLLECTION_NAMES',
      'COLLECTION_STATS'
    ]
    for (const method of collectionMethods) {
      expect(CLIENT_METHODS).toHaveProperty(method)
      expect(SERVER_METHODS).toHaveProperty(method)
    }
  })
})
