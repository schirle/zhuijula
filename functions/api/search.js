import { makeRoute, handleSearch } from '../_shared.js';

export const onRequest = makeRoute(handleSearch);
