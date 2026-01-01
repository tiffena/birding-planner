// functions/api/search_bird.ts
interface Env {
  EBIRD_KV: KVNamespace;
  EBIRD_API_KEY: string;
}


export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => { 
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  if (!q) return new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } });

  const TAXO_KEY = 'taxonomy:v1';
  let taxonomy = await env.EBIRD_KV.get(TAXO_KEY, 'json');
  if (!taxonomy) {
    const resp = await fetch('https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json', {
      headers: { 'X-eBirdApiToken': env.EBIRD_API_KEY }
    });
    const all = await resp.json();
    taxonomy = all.map((s: any) => ({ comName: s.comName, speciesCode: s.speciesCode }));
    await env.EBIRD_KV.put(TAXO_KEY, JSON.stringify(taxonomy), { expirationTtl: 86400 });
  }

  const qWords = q.split(/\s+/);
  const scored = taxonomy
    .map((s: any) => {
      const name = s.comName.toLowerCase();
      const hits = qWords.reduce((acc, w) => acc + (name.includes(w) ? 1 : 0), 0);
      const starts = name.startsWith(q) ? 1 : 0;
      return { ...s, score: hits * 2 + starts * 3 };
    })
    .filter((s: any) => s.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 10);

  return new Response(JSON.stringify(scored), { headers: { 'content-type': 'application/json' } });
};
