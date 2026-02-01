/**
 * CLI Types - Shared type definitions
 */

// Mirrors @dotdo/rpc schema types
export interface RpcMethodSchema {
  name: string
  path: string
  params: number
}

export interface RpcNamespaceSchema {
  name: string
  methods: RpcMethodSchema[]
}

export interface RpcSchema {
  version: 1
  methods: RpcMethodSchema[]
  namespaces: RpcNamespaceSchema[]
}

export interface RpcDoConfig {
  durableObjects: string | string[]
  output?: string
  schemaUrl?: string
  source?: string
}
