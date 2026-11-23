import type { Tier } from '@/client/conversation';
import { pageParam } from '@/paging';
import { isRecordTypeKey } from '@/record-types';

import type { SearchAddress } from './search-address';

/** A page's query as Next hands it over: each field once, repeated, or absent. */
export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

const ID = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
const TIERS: readonly Tier[] = ['campaign', 'system', 'other'];

/** One value of the address's query: the first when it is repeated, empty when absent. */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** An id of the address, or null for anything that cannot be one. */
function idOf(value: string | string[] | undefined): string | null {
  const text = one(value);
  return ID.test(text) ? text : null;
}

/**
 * The search's address read from a page's query (Story 3.9; `type` from Story 4.3 part B): `q`, `s`, `tier`,
 * `material`, `type` and `page`. A value that cannot be one of its kind (an id that is not one, an unknown tier, a
 * record type that is no key's text, a page that is not a number from 1) is left out, never refused; from Story 4.4
 * part B any key is kept, a type the GM approved too. Shared by the search page and a record result's page, whose way
 * back is the same search.
 */
export function searchAddressOf(query: SearchParams): Required<SearchAddress> {
  const type = one(query.type);
  return {
    query: one(query.q),
    searchId: idOf(query.s),
    tier: TIERS.find((word) => word === one(query.tier)) ?? null,
    materialId: idOf(query.material),
    recordType: isRecordTypeKey(type) ? type : null,
    page: pageParam(one(query.page)),
  };
}
