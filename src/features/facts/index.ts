// Public surface of the facts feature: reading facts, their state, and the entry they belong to.

export { currentInventory, groupEntry, type InventoryFact, type SenseView } from './entry-view'
export { FactFlagBadge, FactStateBadge, FactStatusBadge } from './fact-badges'
export { FactClaim } from './fact-claim'
export { FactSheet } from './fact-sheet'
export { type FactState, factState } from './fact-state'
export { FactsBrowser } from './facts-browser'
export { useFact, useManagedEntry, useNodeLocation } from './hooks'
export { useFactSelection } from './selection'
export { summarizeFact } from './summary'
