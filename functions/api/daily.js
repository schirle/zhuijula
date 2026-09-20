import { makeRoute, handleDaily } from '../_shared.js';

export const onRequest = makeRoute((request, url, context) => handleDaily(request, url, context));
