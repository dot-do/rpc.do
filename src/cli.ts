/**
 * rpc.do CLI Entry Point
 *
 * This file serves as the entry point for the CLI and delegates to the
 * modular command structure in ./cli/.
 *
 * @see ./cli/index.ts - Main CLI logic
 * @see ./cli/generate.ts - Generate command
 * @see ./cli/init.ts - Init command
 * @see ./cli/watch.ts - Watch command
 */

import { main } from './cli/index.js'

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
