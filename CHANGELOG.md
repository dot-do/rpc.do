# Changelog

## 0.2.4

### Patch Changes

- Refactor to use capnweb throughout. Added `rpc.do/server` with `createTarget()` and `createHandler()` for wrapping any object/SDK as an RpcTarget. Updated `rpc.do/expose` to use capnweb RpcTarget with prototype methods.

## [0.1.4] - 2026-01-23

- Added wsAdvanced transport with reconnection and heartbeat
- Added oauth.do integration
- Fixed error handling consistency
- Added sideEffects: false for better tree-shaking

## [0.1.0] - Initial Release

- Core RPC proxy functionality
- HTTP, WebSocket, Service Binding transports
- Server handler and Worker export
