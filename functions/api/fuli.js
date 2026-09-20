import { makeRoute, handleFuli } from '../_shared.js';

export const onRequest = makeRoute((request, url, context) => handleFuli(request, url, context));
