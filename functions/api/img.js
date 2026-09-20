import { makeRoute, handleImgProxy } from '../_shared.js';

export const onRequest = makeRoute((request, url) => handleImgProxy(request, url));
