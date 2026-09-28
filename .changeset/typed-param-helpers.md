---
"rpc.do": patch
---

Fixed types: `getMethod`, `createQueryFn`, `createMutationFn` and the React Query/SWR helper types now accept methods that take typed parameters (before, `MethodPaths` only listed zero-argument methods). `createSpy((x: number) => ...)` and `mockTransport({ 'users.get': (id: string) => ... })` now type-check.
