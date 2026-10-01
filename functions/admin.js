export const onRequest = (context) => {
  const url = new URL(context.request.url);
  url.pathname = '/console.html';
  url.search = '';
  return Response.redirect(url.toString(), 301);
};
