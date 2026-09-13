import { handlePushApi } from '../../../worker.js';

export const onRequest = async (context) => {
  try {
    return await handlePushApi(context.request, context.env);
  } catch (error) {
    console.error('[Pages Push API] Request failed:', error);
    return new Response(JSON.stringify({ error: 'push_service_unavailable' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
};
