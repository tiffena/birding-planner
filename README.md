# birding-planner

This app helps to pinpoint a location where a bird has been sighted MANY times, and preferably in flocks.

You can enter a bird species, set your location, choose a distance and a time window, and it tells you where to go on a map and in a list. You are not restricted by using only hotspots or the 30-day sighting limit.

## High-level architecture  

**Technical stack used:**

| Layer     | Option                     | Why                                                                                          |
|-----------|----------------------------|----------------------------------------------------------------------------------------------|
| Frontend  | Cloudflare Pages           | Static HTML/JS, all bundled in same project with logging, fast global edge for static assets |
| Backend   | Cloudflare Pages Functions | Fast global edge for functions, seamless integration with Cloudflare KV cache                |
| Mapping   | Leaflet + OSM              | Free tiles, stable, easy clustering                                                          |
| Geocoding | Nominatim                  | Free API to convert location to Lat/Long.                                                    |
| Caching   | Cloudflare KV              | Simple key-value edge cache to make resolving taxonomy name faster                           |
| Styling   | Tailwind CSS               | For rapid, clean UI development     
| Rate-limiter   | Cloudflare Web Application Firewall    | Prevent single user or bot from overloading system    |

## Project structure and routing 

File layout:
* Project root stores static HTML and client-side logic.
* Pages Functions live under `functions/` as Cloudflare Pages Function uses file-based routing.

``` 
birding-planner/
├─ index.html          # frontend
├─ main.js             # all client‑side logic (map setup, autocomplete, search, grouping)
├─ style.css           # extra styles beyond Tailwind
├─ functions/
   └─ api/
      ├─ search_bird.ts    # taxonomy autocomplete
      ├─ geocode.ts        # Nominatim place → lat/lng
      └─ sightings.ts      # observations with filters
```
