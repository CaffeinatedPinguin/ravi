/**
 * How a rejected promise becomes text a user can read. Anything that is not an Error (a thrown
 * string, a Zod issue wrapper) has no message worth showing, so the caller names the action.
 */
export function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
