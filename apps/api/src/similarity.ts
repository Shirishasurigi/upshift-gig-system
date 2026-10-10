// Simple "how alike are these two gigs?" score between 0 and 1.
// It compares the words in the title (60% weight) and the overview (40% weight).
const STOP_WORDS = new Set(['the', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'at', 'by', 'is', 'are', 'be']);

export function tokens(text: string | null | undefined): Set<string> {
  return new Set(
    (text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
  );
}

// Jaccard: shared words divided by all different words used by either text
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

export type GigText = { title: Set<string>; overview: Set<string> };

export function toGigText(title: string | null, overview: string | null): GigText {
  return { title: tokens(title), overview: tokens(overview) };
}

export function similarity(a: GigText, b: GigText): number {
  return 0.6 * jaccard(a.title, b.title) + 0.4 * jaccard(a.overview, b.overview);
}
