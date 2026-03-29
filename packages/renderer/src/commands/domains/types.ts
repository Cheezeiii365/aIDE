/**
 * @fileoverview Shared shape returned by each `collect*Commands` in this folder.
 *
 * Keeps metadata (`CommandDefinition`) separate from the closure that runs the action.
 */

import type { CommandDefinition } from '@shared/index'

/** Pair consumed by `registerAppCommands`: palette metadata + zero-arg handler. */
export type CommandSpec = { def: CommandDefinition; handler: () => void }
