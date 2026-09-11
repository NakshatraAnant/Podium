/**
 * The one rule from the real-data import brief that is absolute:
 * `AMM_BRANDS_LLP_DATABASE.xlsx` contains a sheet of plaintext credentials,
 * and it must never be opened, read, parsed, or logged.
 *
 * This lives in its own module with no dependencies so it can be imported and
 * tested without pulling in the import script (and its Prisma client, and its
 * destructive `main`).
 */

/**
 * Hard guard, not a filter. Anything that reaches a sheet whose name mentions
 * passwords is a bug in the caller, so this THROWS instead of skipping: a
 * silent skip would let a future refactor start reading credentials without
 * anyone noticing.
 */
export function assertNotForbidden(sheetName: string): void {
  if (/PASSWORD/i.test(sheetName)) {
    throw new Error("Refusing to read a credentials sheet. This sheet must never be opened, parsed, or logged.");
  }
}
