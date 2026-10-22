const reply = (statusCode, error) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(error ? { error } : { ok: true })
});

export async function handler(event) {
  if (event.httpMethod !== 'POST') return reply(405, 'Method not allowed');
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const site = process.env.URL;
  if (!site) return reply(503, 'Site configuration missing');
  const origin = new URL(site).origin;
  if (headers.origin !== origin) return reply(403, 'Invalid origin');
  if (!headers['content-type']?.startsWith('application/json')) return reply(415, 'Expected JSON');
  if (!event.body || event.body.length > 4096) return reply(400, 'Invalid payload');
  let data;
  try { data = JSON.parse(event.body); } catch { return reply(400, 'Invalid JSON'); }
  if (!data || typeof data.event_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.event_id) ||
      !['header', 'hero'].includes(data.placement) || typeof data.page_url !== 'string') {
    return reply(400, 'Invalid event');
  }
  let page;
  try { page = new URL(data.page_url); } catch { return reply(400, 'Invalid page'); }
  if (page.origin !== origin) return reply(400, 'Invalid page origin');
  if (data.ttclid !== undefined && (typeof data.ttclid !== 'string' || data.ttclid.length > 1024)) {
    return reply(400, 'Invalid click ID');
  }
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) return reply(503, 'Events API not configured');
  const user = { user_agent: headers['user-agent'] || '' };
  if (headers['x-nf-client-connection-ip']) user.ip = headers['x-nf-client-connection-ip'];
  if (data.ttclid) user.ttclid = data.ttclid;
  const payload = {
    event_source: 'web',
    event_source_id: process.env.TIKTOK_PIXEL_ID || 'DBD02BJC77UASCMGFR6G',
    data: [{ event: 'Contact', event_time: Math.floor(Date.now() / 1000),
      event_id: data.event_id, user,
      page: { url: page.origin + page.pathname },
      properties: { content_name: 'Telegram', content_category: data.placement } }]
  };
  try {
    const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': token },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return reply(502, 'Events API request failed');
    const result = await response.json();
    if (result.code !== 0) return reply(502, 'Events API rejected event');
    return reply(200);
  } catch { return reply(502, 'Events API unavailable'); }
}
