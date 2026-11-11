/**
 * For tests that render a whole console page and drive several Base UI popups or many rows: under
 * coverage instrumentation and a full parallel run they outlast the 5s default.
 */
export const HEAVY_TEST_MS = 20_000
