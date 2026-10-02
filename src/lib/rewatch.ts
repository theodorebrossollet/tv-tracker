// Limits for rewatch history. Pure, so client components and tests can import
// them without pulling in the database.

/** Past runs kept per show and account; starting over at this count is refused. */
export const MAX_PAST_RUNS = 20;

/** Past watches kept per movie and account; watching again at this count is refused. */
export const MAX_PAST_WATCHES = 20;
