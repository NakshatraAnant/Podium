/**
 * The one rule from the real-data import brief that is absolute:
 * `AMM_BRANDS_LLP_DATABASE.xlsx` contains a sheet of plaintext credentials,
 * and it must never be opened, read, parsed, or logged.
 *
 * The 2026-09-15 data-reset directive widened that rule from one category to
 * four — credentials, salary/compensation, bank/financial account details,
 * and government identity numbers — and from sheets to columns as well,
 * because an employee list carries those as columns inside an otherwise
 * perfectly importable sheet. Podium is an event-production OS, not a
 * payroll or KYC system: it has no schema for any of this and no business
 * reason to hold it.
 *
 * This lives in its own module with no dependencies so it can be imported and
 * tested without pulling in the import script (and its Prisma client, and its
 * destructive `main`).
 */

/**
 * Sheet-level patterns. A whole sheet matching one of these is a sheet whose
 * *subject* is sensitive — there is nothing importable to salvage from it.
 */
const FORBIDDEN_SHEET_PATTERNS: ReadonlyArray<RegExp> = [
  /PASSWORD/i,
  /CREDENTIAL/i,
  /\bLOGINS?\b/i,
  /SALAR/i,
  /PAYROLL/i,
  /\bCTC\b/i,
  /\bPAYSLIPS?\b/i,
  /BANK\s*(ACCOUNT|DETAIL)/i,
  /\bIFSC\b/i,
  /\bAADHA?A?R\b/i,
  /\bPAN\s*(CARD|NO|NUMBER)\b/i,
  /PASSPORT/i,
];

/**
 * Column-level patterns. Unlike sheets, a sensitive *column* sits alongside
 * columns we legitimately need (a name, a city, a role), so these are used to
 * drop the column and report it — not to refuse the whole sheet.
 *
 * Deliberately matched against the header cell only. No value from a dropped
 * column is ever read, so nothing sensitive can reach a log, a diff, or the
 * database even by accident.
 */
const SENSITIVE_COLUMN_PATTERNS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: "credential", pattern: /PASSWORD|PASSCODE|CREDENTIAL|SECRET|\bOTP\b|\bPIN\b|\bAPI[\s_-]*KEY\b|\bTOKEN\b/i },
  { label: "salary", pattern: /SALAR|\bCTC\b|PAYROLL|\bWAGE\b|\bSTIPEND\b|COMPENSATION|\bPAYSLIP\b|\bPF\b|\bESIC?\b|\bTDS\b|IN[\s-]*HAND|GROSS\s*PAY|NET\s*PAY/i },
  // "BANK" alone is unusable here: Indian street addresses use bank branches
  // as landmarks constantly ("next to HDFC Bank"), and matching those would
  // exclude legitimate address columns wholesale. Require account context.
  { label: "bank-account", pattern: /BANK\s*(A\/?C|ACCT|ACCOUNT|NAME|DETAIL|BRANCH)|\bIFSC\b|\bACCOUNT\s*(NO\b|NUMBER|#)|\bA\/C\s*(NO|NUMBER)/i },
  { label: "government-id", pattern: /\bAADHA?A?R\b|\bPAN\b|\bUAN\b|PASSPORT|\bVOTER\s*ID\b|DRIV(ING|ER'?S)\s*(LICEN[CS]E)|\bSSN\b|\bNATIONAL\s*ID\b|\bGOVT?\.?\s*ID\b/i },
];

/**
 * Hard guard, not a filter. Anything that reaches a sheet whose name mentions
 * passwords is a bug in the caller, so this THROWS instead of skipping: a
 * silent skip would let a future refactor start reading credentials without
 * anyone noticing.
 */
export function assertNotForbidden(sheetName: string): void {
  if (isForbiddenSheet(sheetName)) {
    throw new Error(
      `Refusing to read a sensitive sheet ("${sheetName}"). This sheet must never be opened, parsed, or logged.`,
    );
  }
}

/** Non-throwing form, for callers that need to *enumerate* sheets before choosing which to read. */
export function isForbiddenSheet(sheetName: string): boolean {
  return FORBIDDEN_SHEET_PATTERNS.some((pattern) => pattern.test(sheetName));
}

/**
 * Which of the four categories a column header falls into, or null if the
 * column is safe to read. Returning the label (rather than a boolean) is what
 * lets the caller report *what* it excluded from *which* file, as the
 * directive requires — an exclusion nobody can see is not a real control.
 */
export function sensitiveColumnCategory(header: string): string | null {
  return SENSITIVE_COLUMN_PATTERNS.find(({ pattern }) => pattern.test(header))?.label ?? null;
}

export function isSensitiveColumn(header: string): boolean {
  return sensitiveColumnCategory(header) !== null;
}
