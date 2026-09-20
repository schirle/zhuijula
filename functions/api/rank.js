import { makeRoute, handleRank } from '../_shared.js';

export const onRequest = makeRoute((request, url, context) => handleRank(request, url, context));
