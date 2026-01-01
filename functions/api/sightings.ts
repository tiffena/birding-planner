interface Env {
  EBIRD_API_KEY: string;
}

type Obs = {
  obsDt: string;
  comName: string;
  locName: string;
  lat: number;
  lng: number;
  howMany?: number;
  subId?: string;
};

// Haversine distance in km
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Earth radius km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code"); // eBird species code
  let comName = url.searchParams.get("name"); // common name for GBIF lookup
  const latStr = url.searchParams.get("lat") || "";
  const lngStr = url.searchParams.get("lng") || "";
  const distMi = clamp(parseFloat(url.searchParams.get("dist") || "15"), 1, 50);

  const daysBackParam = url.searchParams.get("daysBack");
  const monthParam = url.searchParams.get("month");
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  if (!code || Number.isNaN(lat) || Number.isNaN(lng)) {
    return new Response(JSON.stringify({ error: "Missing params: code, lat, lng" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  // Decide whether to use GBIF
  let useGBIF = false;
  if (daysBackParam) {
    const daysBack = parseInt(daysBackParam, 10);
    if (daysBack > 30) useGBIF = true;
  }
  if (startParam && endParam) {
    const startDate = new Date(startParam);
    const endDate = new Date(endParam);
    const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 30) useGBIF = true;
  }

  let data: Obs[] = [];

  if (!useGBIF) {
    // --- eBird workflow ---
    const distKm = Math.min(Math.round(distMi * 1.60934), 50);
    const apiUrl = new URL(`https://api.ebird.org/v2/data/obs/geo/recent/${code}`);
    apiUrl.searchParams.set("lat", lat.toString());
    apiUrl.searchParams.set("lng", lng.toString());
    apiUrl.searchParams.set("dist", distKm.toString());
    apiUrl.searchParams.set("sort", "date");

    if (daysBackParam) {
      const daysBack = clamp(parseInt(daysBackParam, 10), 1, 30);
      apiUrl.searchParams.set("back", daysBack.toString());
    } else {
      apiUrl.searchParams.set("back", "30");
    }

    console.log("eBird URL:", apiUrl.toString());

    const resp = await fetch(apiUrl.toString(), {
      headers: { "X-eBirdApiToken": env.EBIRD_API_KEY }
    });
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `eBird API error ${resp.status}` }), {
        status: resp.status,
        headers: { "content-type": "application/json" }
      });
    }
    const json = await resp.json();
    data = json.map((o: any) => ({
      obsDt: o.obsDt,
      comName: o.comName,
      locName: o.locName,
      lat: o.lat,
      lng: o.lng,
      howMany: o.howMany,
      subId: o.subId || o.subID
    }));
  } else {
    // --- GBIF workflow ---
    if (!comName && code) {
      try {
        const raw = await env.EBIRD_KV.get("taxonomy:v1");
        if (raw) {
          const list = JSON.parse(raw);
          const match = list.find((entry: any) => entry.speciesCode === code);
          if (match) comName = match.comName;
        }
      } catch (err) {
        console.warn("KV taxonomy lookup failed:", err);
      }
    }
    if (!comName) {
      return new Response(JSON.stringify({ error: "Missing common name for GBIF lookup" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }

    // Step 1: lookup taxonKey
    const gbifSearchUrl = `https://api.gbif.org/v1/species/search?q=${encodeURIComponent(comName)}&rank=SPECIES&limit=1`;
    const searchResp = await fetch(gbifSearchUrl);
    const searchData = await searchResp.json();
    if (!searchData.results || searchData.results.length === 0) {
      return new Response(JSON.stringify({ error: "GBIF taxonKey not found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }
    const taxonKey = searchData.results[0].nubKey;

    // Step 2: query GBIF occurrences
    const gbifUrl = new URL("https://api.gbif.org/v1/occurrence/search");
    gbifUrl.searchParams.set("taxonKey", taxonKey.toString());
    gbifUrl.searchParams.set("datasetKey", "4fa7b334-ce0d-4e88-aaae-2e0c138d049e"); // eBird dataset
    gbifUrl.searchParams.set("hasCoordinate", "true");
    gbifUrl.searchParams.set("limit", "300");

    // bounding box ~15km around lat/lng
    gbifUrl.searchParams.set("decimalLatitude", `${lat - 0.3},${lat + 0.3}`);
    gbifUrl.searchParams.set("decimalLongitude", `${lng - 0.3},${lng + 0.3}`);

    if (startParam && endParam) {
      gbifUrl.searchParams.set("eventDate", `${startParam},${endParam}`);
    }

    console.log("GBIF URL:", gbifUrl.toString());

    const resp = await fetch(gbifUrl.toString());
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `GBIF API error ${resp.status}` }), {
        status: resp.status,
        headers: { "content-type": "application/json" }
      });
    }
    const gbifData = await resp.json();

    // Normalize GBIF results into Obs[]
    data = gbifData.results.map((o: any) => ({
      obsDt: o.eventDate || `${o.year}-${o.month}-${o.day}`,
      comName: o.vernacularName || o.scientificName,
      locName: o.locality || o.locationRemarks || "Unknown",
      lat: o.decimalLatitude,
      lng: o.decimalLongitude,
      howMany: o.individualCount,
      subId: o.catalogNumber || o.occurrenceID
    }));
  }

  // Strict radius enforcement
  const maxKm = distMi * 1.60934;
  data = data.filter(o => haversine(lat, lng, o.lat, o.lng) <= maxKm);

  // Local date filtering (applies to both eBird and GBIF results)
  if (!daysBackParam) {
    if (monthParam) {
      const [yStr, mStr] = monthParam.split("-");
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      if (!Number.isNaN(y) && !Number.isNaN(m)) {
        data = data.filter(o => {
          const d = new Date(o.obsDt);
          return d.getUTCFullYear() === y && (d.getUTCMonth() + 1) === m;
        });
      }
    } else if (startParam && endParam) {
      const start = new Date(startParam + "T00:00:00Z");
      const end = new Date(endParam + "T23:59:59Z");
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        data = data.filter(o => {
          const d = new Date(o.obsDt);
          return d >= start && d <= end;
        });
      }
    }
  }

  // Sort descending by date
  const sightings = data.sort((a, b) => (a.obsDt < b.obsDt ? 1 : -1));

  return new Response(JSON.stringify({ center: { lat, lng }, sightings }), {
    headers: { "content-type": "application/json" }
  });
};
