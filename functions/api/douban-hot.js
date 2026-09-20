import { makeRoute, handleDoubanHot } from '../_shared.js';

export const onRequest = makeRoute((request, url) => handleDoubanHot(request, url));
