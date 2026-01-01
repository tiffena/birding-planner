// functions/api/geocode.ts
export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  if (!q) {
    return new Response(JSON.stringify({ error: 'q required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  const apiUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;

  let resp;
  try {
    resp = await fetch(apiUrl, {
      headers: {
        // REQUIRED: include a descriptive UA with contact info
        'User-Agent': 'bird-nearby-app/1.0 (https://yourdomain.com/contact)'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'fetch_failed', details: String(err) }), {
      status: 502,
      headers: { 'content-type': 'application/json' }
    });
  }

  if (!resp.ok) {
    return new Response(JSON.stringify({ error: `Nominatim error ${resp.status}` }), {
      status: resp.status,
      headers: { 'content-type': 'application/json' }
    });
  }

  let results;
  try {
    results = await resp.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json_from_nominatim' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }

  if (!Array.isArray(results) || results.length === 0) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' }
    });
  }

  const r = results[0];
  const lat = parseFloat(r.lat);
  const lng = parseFloat(r.lon);
  const placeName = r.display_name;

  return new Response(JSON.stringify({ lat, lng, placeName }), {
    headers: { 'content-type': 'application/json' }
  });
};
