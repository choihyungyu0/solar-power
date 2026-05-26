import { runDebugSelectBuld } from './climate-rooftop-analysis';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  try {
    const result = await runDebugSelectBuld(await request.json().catch(() => null));

    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        source: 'climate.gg-live',
        message: error instanceof Error ? error.message : 'debug-select-buld 요청을 처리하지 못했습니다.',
        diagnostics: {},
      },
      error instanceof Error && error.name === 'ValidationError' ? 400 : 200,
    );
  }
}
