import { makeRoute, handleConfig } from '../_shared.js';

export const onRequest = makeRoute((request, url, context) => handleConfig(request, url, context));
