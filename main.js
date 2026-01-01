// main.js
// Full client-side script integrating:
// - Autocomplete
// - GPS
// - Search with filters
// - Map rendering with radius + markers
// - Grouped sightings list with expand/collapse
// - Click → zoom + popup (group header and individual sightings)

// ----------------------
// Map setup and globals
// ----------------------
let map;
let radiusCircle = null;
// Store markers keyed by locName and subId for flexible lookup
let markers = {};
// Track expanded/collapsed state per location group
let expandedGroups = {};

// DOM refs (resolved after DOMContentLoaded)
let birdInput, birdCodeInput, suggestionsDiv;
let locInput, latInput, lngInput, distInput;
let searchPanel, resultsList, summary, speciesTitle, searchMeta;

document.addEventListener('DOMContentLoaded', () => {
  // Resolve refs
  birdInput = document.getElementById('birdInput');
  birdCodeInput = document.getElementById('birdCode');
  suggestionsDiv = document.getElementById('suggestions');
  locInput = document.getElementById('locInput');
  latInput = document.getElementById('lat');
  lngInput = document.getElementById('lng');
  distInput = document.getElementById('distInput');
  searchPanel = document.getElementById('searchPanel');
  resultsList = document.getElementById('resultsList');
  summary = document.getElementById('summary');
  speciesTitle = document.getElementById('speciesTitle');
  searchMeta = document.getElementById('searchMeta');

  // Initialize map
  map = L.map('map').setView([37.0902, -95.7129], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  // Bind autocomplete listeners
  setupAutocomplete();

  // Hide suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!suggestionsDiv.contains(e.target) && e.target !== birdInput) {
      suggestionsDiv.classList.add('hidden');
    }
  });
});

// ----------------------
// Autocomplete
// ----------------------
function setupAutocomplete() {
  birdInput.addEventListener('input', debounce(async (e) => {
    const query = e.target.value.trim();
    if (query.length < 3) {
      suggestionsDiv.classList.add('hidden');
      suggestionsDiv.innerHTML = '';
      return;
    }

    try {
      const res = await fetch(`/api/search_bird?q=${encodeURIComponent(query)}`);
      const birds = await res.json();
      suggestionsDiv.innerHTML = '';
      if (birds.length > 0) {
        suggestionsDiv.classList.remove('hidden');
      } else {
        suggestionsDiv.classList.add('hidden');
        return;
      }

      birds.forEach(bird => {
        const div = document.createElement('div');
        div.className = "p-2 hover:bg-blue-50 cursor-pointer border-b last:border-0";
        div.textContent = bird.comName;
        div.onclick = () => {
          birdInput.value = bird.comName;
          birdCodeInput.value = bird.speciesCode;
          suggestionsDiv.classList.add('hidden');
        };
        suggestionsDiv.appendChild(div);
      });
    } catch (err) {
      console.warn('Autocomplete error:', err);
    }
  }, 150));
}

// ----------------------
// GPS button
// ----------------------
function useGPS() {
  if (!navigator.geolocation) {
    alert("Geolocation not supported.");
    return;
  }
  locInput.value = "Locating...";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      latInput.value = pos.coords.latitude;
      lngInput.value = pos.coords.longitude;
      locInput.value = "My Current Location";
    },
    () => {
      locInput.value = "";
      alert("Unable to get your location.");
    }
  );
}
window.useGPS = useGPS; // exposed for onclick in HTML

// ----------------------
// Helpers
// ----------------------
function drawRadius(lat, lng, miles) {
  const meters = miles * 1609.34;
  if (radiusCircle) map.removeLayer(radiusCircle);
  radiusCircle = L.circle([lat, lng], {
    radius: meters,
    color: '#10b981',
    fillColor: '#10b981',
    fillOpacity: 0.1
  }).addTo(map);
}

function getDateModeAndParams() {
  const modeEl = document.querySelector('input[name="dateMode"]:checked');
  const mode = modeEl ? modeEl.value : 'days';
  const params = {};
  if (mode === 'days') {
    params.daysBack = document.getElementById('daysBackInput').value;
  } else if (mode === 'month') {
    const m = document.getElementById('monthInput').value;
    if (!m) throw new Error("Please select a month.");
    params.month = m;
  } else if (mode === 'range') {
    const start = document.getElementById('startDate').value;
    const end = document.getElementById('endDate').value;
    if (!start || !end) throw new Error("Please select both start and end dates.");
    params.start = start;
    params.end = end;
  }
  return { mode, params };
}

function formatMeta(dist, mode, lat, lng) {
  if (mode === 'days') {
    const days = document.getElementById('daysBackInput').value;
    return `${dist} mi radius • Last ${days} days • Center: (${lat}, ${lng})`;
  }
  if (mode === 'month') {
    const m = document.getElementById('monthInput').value;
    return `${dist} mi radius • Month ${m} • Center: (${lat}, ${lng})`;
  }
  const start = document.getElementById('startDate').value;
  const end = document.getElementById('endDate').value;
  return `${dist} mi radius • ${start} → ${end} • Center: (${lat}, ${lng})`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}

// ----------------------
// Map rendering
// ----------------------
function renderMap(center, sightings, distMiles) {
  // Clear old markers
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};

  // Center and radius
  map.setView([center.lat, center.lng], 11);
  drawRadius(center.lat, center.lng, parseFloat(distMiles));

  // Add markers
  sightings.forEach(s => {
    const popupHtml = `<b>${s.comName}</b><br>${s.locName}<br>${s.obsDt}<br>Count: ${s.howMany || 1}`;
    const marker = L.marker([s.lat, s.lng]).bindPopup(popupHtml).addTo(map);
    // Store marker by locName (group-level) and subId (sighting-level)
    markers[s.locName] = marker;
    if (s.subId) {
      markers[s.subId] = marker;
    }
  });
}

// ----------------------
// Grouping and list rendering
// ----------------------
function groupSightings(sightings) {
  const byLocation = new Map();
  sightings.forEach(s => {
    if (!byLocation.has(s.locName)) {
      byLocation.set(s.locName, []);
    }
    byLocation.get(s.locName).push({
      date: s.obsDt,
      count: s.howMany || 1,
      subId: s.subId
    });
  });

  const groups = [];
  byLocation.forEach((dates, locName) => {
    dates.sort((a, b) => new Date(b.date) - new Date(a.date));
    const total = dates.reduce((sum, d) => sum + d.count, 0);
    const dateRange = dates.length > 1
      ? `${dates[dates.length - 1].date}–${dates[0].date}`
      : dates[0].date;
    groups.push({ locName, dates, total, dateRange });
  });

  // Sort groups by latest date desc
  groups.sort((a, b) => new Date(b.dates[0].date) - new Date(a.dates[0].date));
  return groups;
}

function renderGroupedList(sightings) {
  resultsList.innerHTML = '';

  const groups = groupSightings(sightings);
  if (groups.length === 0) {
    resultsList.innerHTML = '<li class="p-4 text-gray-500 italic">No sightings found within your filters.</li>';
    return;
  }

  groups.forEach(group => {
    const li = document.createElement('li');
    li.className = "p-3";

    // Header: locName, dateRange, total count
    const header = document.createElement('div');
    header.className = "grid grid-cols-[1fr_auto_auto] gap-2 items-center cursor-pointer";
    header.innerHTML = `
      <div class="font-bold text-slate-700 truncate">${group.locName}</div>
      <div class="text-xs text-slate-600 tabular-nums text-right">${group.dateRange}</div>
      <div class="text-xs font-semibold text-emerald-700 text-right">Total Count: ${group.total}</div>
    `;
    header.onclick = () => {
      // Zoom to location marker
      const locMarker = markers[group.locName];
      if (locMarker) {
        map.flyTo(locMarker.getLatLng(), 13);
        locMarker.openPopup();
      }
      // Toggle expand/collapse
      expandedGroups[group.locName] = !expandedGroups[group.locName];
      renderGroupedList(sightings);
    };

    li.appendChild(header);

    // Expanded details: individual dates
    if (expandedGroups[group.locName]) {
      const ul = document.createElement('ul');
      ul.className = "mt-2 pl-1";

      group.dates.forEach(d => {
        const row = document.createElement('li');
        row.className = "grid grid-cols-[auto_auto_1fr] gap-2 py-1 text-xs items-center";
        row.innerHTML = `
          <span class="text-slate-600 tabular-nums">${d.date}</span>
          <span class="text-slate-500">Count: </span>
          <span class="text-emerald-700 font-semibold tabular-nums">${d.count}</span>
        `;
        row.onclick = () => {
          if (d.subId && markers[d.subId]) {
            map.flyTo(markers[d.subId].getLatLng(), 14);
            markers[d.subId].openPopup();
          } else if (markers[group.locName]) {
            map.flyTo(markers[group.locName].getLatLng(), 14);
            markers[group.locName].openPopup();
          }
        };
        ul.appendChild(row);
      });

      li.appendChild(ul);
    }


    resultsList.appendChild(li);
  });
}

// ----------------------
// Summary header
// ----------------------
function renderSummary(speciesName, dist, mode, lat, lng) {
  speciesTitle.textContent = speciesName;
  searchMeta.textContent = formatMeta(dist, mode, lat, lng);
  summary.classList.remove('hidden');
}

// ----------------------
// Main search flow
// ----------------------
async function findBirds() {
  const code = birdCodeInput.value;
  const dist = distInput.value;
  let lat = latInput.value;
  let lng = lngInput.value;
  const speciesName = birdInput.value.trim();

  if (!code) {
    alert("Please select a bird.");
    return;
  }
  if (!locInput.value.trim() && (!lat || !lng)) {
    alert("Please enter a location.");
    return;
  }

  // Geocode if lat/lng missing
  if (!lat || !lng) {
    try {
      const geoRes = await fetch(`/api/geocode?q=${encodeURIComponent(locInput.value.trim())}`);
      const geo = await geoRes.json();
      if (geo.error) {
        alert(geo.error);
        return;
      }
      lat = geo.lat;
      lng = geo.lng;
      latInput.value = lat;
      lngInput.value = lng;
    } catch (err) {
      alert("Geocoding failed. Please try again.");
      return;
    }
  }

  // Date params
  let mode, dateParams;
  try {
    const dm = getDateModeAndParams();
    mode = dm.mode;
    dateParams = dm.params;
  } catch (err) {
    alert(err.message);
    return;
  }

  // Build query
  const params = new URLSearchParams({ code, lat, lng, dist });
  if (dateParams.daysBack) params.set('daysBack', dateParams.daysBack);
  if (dateParams.month) params.set('month', dateParams.month);
  if (dateParams.start && dateParams.end) {
    params.set('start', dateParams.start);
    params.set('end', dateParams.end);
  }

  // Fetch sightings
  let data;
  try {
    const res = await fetch(`/api/sightings?${params.toString()}`);
    data = await res.json();
    if (data.error) {
      alert(data.error);
      return;
    }
  } catch (err) {
    alert("Fetching sightings failed. Please try again.");
    return;
  }

  // Collapse search panel
  searchPanel.open = false;

  // Reset group expansion state each new search
  expandedGroups = {};

  // Summary
  renderSummary(speciesName, dist, mode, lat, lng);

  // Render map and list
  renderMap(data.center, data.sightings, dist);
  renderGroupedList(data.sightings);
}
window.findBirds = findBirds; // exposed for onclick in HTML
