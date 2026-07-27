/** Filter nav component groups by user query (code, name, part numbers). */

import {
  buildSearchAndGroups,
  haystackMatchesAndGroups,
  normalizeSearchQuery,
} from "../../shared/searchLexicon.js";

export type NavSearchItem = {
  code: string;
  label: string;
  search_text?: string;
  type_ru?: string;
  home_zone?: string;
};

export type NavSearchGroup<T extends NavSearchItem = NavSearchItem> = {
  id: string;
  label: string;
  items: T[];
};

export function normalizeNavSearchQuery(raw: string): string {
  return normalizeSearchQuery(raw);
}

/** Expand query into AND-of-OR synonym groups (project-wide lexicon). */
export function expandNavSearchTokenGroups(query: string): string[][] {
  return buildSearchAndGroups(query);
}

/** Flat tokens for callers that only need a list (first alt of each group). */
export function expandNavSearchTokens(query: string): string[] {
  return expandNavSearchTokenGroups(query).map((g) => g[0]).filter(Boolean);
}

function itemHaystack(it: NavSearchItem): string {
  return `${it.code} ${it.label} ${it.search_text || ""} ${it.type_ru || ""} ${it.home_zone || ""}`.toLowerCase();
}

function filterGroups<T extends NavSearchItem>(
  groups: Array<NavSearchGroup<T>>,
  selectedCode: string,
  match: (hay: string, it: T) => boolean,
): Array<NavSearchGroup<T>> {
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        if (selectedCode && it.code === selectedCode) return true;
        return match(itemHaystack(it), it);
      }),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Keep items matching query tokens in code/label/search_text/type.
 * Uses project-wide stopwords + bilingual synonyms (shared/searchLexicon).
 * Strict AND-of-OR first; soft OR fallback for multi-token natural queries.
 * Always keep `selectedCode` so the select value stays valid while filtering.
 */
export function filterNavGroupsByQuery<T extends NavSearchItem>(
  groups: Array<NavSearchGroup<T>>,
  query: string,
  selectedCode = "",
): Array<NavSearchGroup<T>> {
  const tokenGroups = expandNavSearchTokenGroups(query);
  if (!tokenGroups.length) return groups;

  const andHit = filterGroups(groups, selectedCode, (hay) =>
    haystackMatchesAndGroups(hay, tokenGroups),
  );
  const andMeaningful = andHit.some((g) =>
    g.items.some((i) => !selectedCode || i.code !== selectedCode),
  );
  if (andMeaningful) return andHit;

  // Soft OR: any significant alt (≥4 chars) from any group.
  const soft = tokenGroups.flatMap((g) => g.filter((t) => t.length >= 4));
  if (soft.length >= 1 && tokenGroups.length >= 2) {
    const orHit = filterGroups(groups, selectedCode, (hay) => soft.some((t) => hay.includes(t)));
    if (orHit.length) return orHit;
  }
  return andHit;
}
