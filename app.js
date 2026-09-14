// App State
const state = {
  hash: localStorage.getItem('abm_hash') || 'b10c36fd2123fc0faf30e4524fd65e53',
  googleApiKey: localStorage.getItem('abm_google_key') || '',
  mapStyle: localStorage.getItem('abm_map_style') || 'satellite',
  trafficLayerActive: localStorage.getItem('abm_traffic_active') !== 'false',
  soundEnabled: localStorage.getItem('abm_sound') !== 'false',
  allLines: [],
  currentDirection: 'SAIDA',
  addrDirection: 'SAIDA',
  currentLine: null,
  lineDetails: null,
  targetStopIndex: 0,
  userLocation: null,
  searchedLocation: null, // { lat, lon, name }
  busLocation: null,
  busActive: false,
  trackingTimer: null,
  simulating: false,
  simInterval: null,
  simIndex: 0,
  alertTriggeredForTrip: false,
  deferredPrompt: null,
  lastTrafficSync: 0,
  cachedTrafficDurationSeconds: null,
  pickingOnMap: false,
  sheetMinimized: localStorage.getItem("abm_sheet_minimized") === "true",
  zenMode: false
};

// Map & Layer State
let map = null;
let baseLayers = {};
let trafficLayer = null;
let routePolyline = null;
let busMarker = null;
let userMarker = null;
let destinationMarker = null;
let walkingPolyline = null;
let stopMarkers = [];

// Force clear old Service Worker caches on startup
if ('caches' in window) {
  caches.keys().then(keys => {
    keys.filter(k => k !== 'fretado-cache-v3.3').forEach(k => caches.delete(k));
  });
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function playChime() {
  if (!state.soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) {
    console.log('Audio error:', e);
  }
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Initialize Leaflet Map
function initMap() {
  const googleSatPure = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
  });

  const googleSatHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
  });

  const googleStreets = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
  });

  const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd'
  });

  baseLayers = {
    satellitePure: googleSatPure,
    satelliteHybrid: googleSatHybrid,
    streets: googleStreets,
    dark: cartoDark
  };

  trafficLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=h,traffic&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    opacity: 0.95,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
  });

  const initialBase = (state.mapStyle === 'satellite') ? (state.trafficLayerActive ? baseLayers.satellitePure : baseLayers.satelliteHybrid) : (baseLayers[state.mapStyle] || baseLayers.streets);

  map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    layers: [initialBase]
  }).setView([-22.84, -47.05], 13);

  if (state.trafficLayerActive) {
    trafficLayer.addTo(map);
  }
  updateTrafficBadge();

  // Handle map clicks (for "Pick on Map" mode)
  map.on('click', (e) => {
    if (state.pickingOnMap) {
      stopPickingOnMap();
      const lat = e.latlng.lat;
      const lon = e.latlng.lng;
      findClosestLines(lat, lon, `Local Selecionado no Mapa (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
    }
  });

  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(
      pos => {
        state.userLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
        updateUserMarker();
      },
      err => console.log('Geolocation:', err.message),
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
  }
}

function startPickingOnMap() {
  state.pickingOnMap = true;
  document.getElementById('modal-address-finder').classList.add('hidden');
  document.getElementById('pick-mode-banner').classList.remove('hidden');
  document.getElementById('map').classList.add('picking-mode-cursor');
  showToast('🎯 Toque no mapa onde você está ou para onde quer ir!');
}

function stopPickingOnMap() {
  state.pickingOnMap = false;
  document.getElementById('pick-mode-banner').classList.add('hidden');
  document.getElementById('map').classList.remove('picking-mode-cursor');
}

function switchBaseLayer(styleName) {
  state.mapStyle = styleName;
  localStorage.setItem('abm_map_style', styleName);

  // Remove current base layers
  Object.values(baseLayers).forEach(layer => {
    if (map.hasLayer(layer)) map.removeLayer(layer);
  });

  let targetBase;
  if (styleName === 'satellite') {
    targetBase = state.trafficLayerActive ? baseLayers.satellitePure : baseLayers.satelliteHybrid;
  } else if (styleName === 'streets') {
    targetBase = baseLayers.streets;
  } else {
    targetBase = baseLayers.dark;
  }

  targetBase.addTo(map);

  if (state.trafficLayerActive && !map.hasLayer(trafficLayer)) {
    trafficLayer.addTo(map);
  }

  const btn = document.getElementById('btn-toggle-layer');
  if (btn) {
    if (styleName === 'satellite') {
      btn.innerText = '🛰️';
      btn.title = 'Mapa Satélite Ativo (Toque para Ruas)';
    } else if (styleName === 'streets') {
      btn.innerText = '🗺️';
      btn.title = 'Mapa de Ruas Google Ativo (Toque para Noturno)';
    } else {
      btn.innerText = '🌙';
      btn.title = 'Mapa Noturno Ativo (Toque para Satélite)';
    }
  }
}

function toggleTrafficLayer() {
  state.trafficLayerActive = !state.trafficLayerActive;
  localStorage.setItem('abm_traffic_active', state.trafficLayerActive);
  const btn = document.getElementById('btn-toggle-traffic');

  if (state.trafficLayerActive) {
    // If on satellite, switch to clean pure satellite so h,traffic provides labels cleanly
    if (state.mapStyle === 'satellite') {
      if (map.hasLayer(baseLayers.satelliteHybrid)) map.removeLayer(baseLayers.satelliteHybrid);
      baseLayers.satellitePure.addTo(map);
    }
    trafficLayer.addTo(map);
    if (btn) btn.classList.add('active-traffic');
    showToast('🚦 Trânsito Google em tempo real ativado.');
  } else {
    if (map.hasLayer(trafficLayer)) map.removeLayer(trafficLayer);
    // If on satellite, switch back to hybrid so labels remain visible
    if (state.mapStyle === 'satellite') {
      if (map.hasLayer(baseLayers.satellitePure)) map.removeLayer(baseLayers.satellitePure);
      baseLayers.satelliteHybrid.addTo(map);
    }
    if (btn) btn.classList.remove('active-traffic');
    showToast('Trânsito ocultado.');
  }
  updateTrafficBadge();
}

function updateTrafficBadge() {
  const badge = document.getElementById('traffic-badge');
  const badgeText = document.getElementById('traffic-badge-text');
  if (state.trafficLayerActive) {
    badge.classList.remove('hidden');
    badgeText.innerText = 'Trânsito Google Ao Vivo';
  } else {
    badge.classList.add('hidden');
  }
}

function updateUserMarker() {
  if (!state.userLocation || !map) return;
  const latLng = [state.userLocation.lat, state.userLocation.lng];
  if (!userMarker) {
    const icon = L.divIcon({
      className: 'user-marker-icon',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
    userMarker = L.marker(latLng, { icon }).addTo(map).bindPopup('Você está aqui');
  } else {
    userMarker.setLatLng(latLng);
  }
}

// Validate Hash
function getValidHash() {
  let h = localStorage.getItem('abm_hash');
  if (!h || h.trim().length < 20 || h === 'undefined' || h === 'null') {
    h = 'b10c36fd2123fc0faf30e4524fd65e53';
    localStorage.setItem('abm_hash', h);
  }
  return h.trim();
}

// Fetch all lines (with multi-tier fallback so it never fails)
async function loadPublicData() {
  state.hash = getValidHash();
  let loaded = false;

  // 1. Try local server API proxy with 4s timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`/api/get_public_link_data.php?hash=${state.hash}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.grupos && data.grupos.length > 0) {
        state.allLines = [];
        data.grupos.forEach(g => {
          if (g.lines) {
            g.lines.forEach(l => {
              const fullLineInfo = (data.full_lines_data && data.full_lines_data[l.codigo]) || {};
              state.allLines.push({
                id: l.id,
                codigo: l.codigo,
                nome: fullLineInfo.linha || l.codigo,
                horainicial: fullLineInfo.horainicial || '',
                horafinal: fullLineInfo.horafinal || '',
                origem: fullLineInfo.enderecoInicial || '',
                destino: fullLineInfo.enderecoFinal || '',
                veiculo: fullLineInfo.veiculo || ''
              });
            });
          }
        });
        if (state.allLines.length > 0) {
          renderLinesModal();
          loaded = true;
        }
      }
    }
  } catch (err) {
    console.warn('Live API fetch failed, trying local cache backup...', err);
  }

  // 2. Fallback to pre-cached lines JSON (instant and 100% offline-ready)
  if (!loaded) {
    try {
      const res = await fetch('cache_lines_b10c36fd2123fc0faf30e4524fd65e53.json');
      if (res.ok) {
        const cachedLines = await res.json();
        if (Array.isArray(cachedLines) && cachedLines.length > 0) {
          state.allLines = cachedLines.map(l => ({
            id: l.id,
            codigo: l.codigo,
            nome: l.nome,
            horainicial: l.horainicial || '',
            horafinal: l.horafinal || '',
            origem: '',
            destino: '',
            veiculo: '',
            cachedDetails: {
              desenhoRota: (l.desenhoRota && l.desenhoRota.length > 0) ? l.desenhoRota : (l.pontos || []).map(p => ({ latitude: p.latitude, longitude: p.longitude })),
              pontosDeParada: l.pontos || []
            }
          }));
          renderLinesModal();
          loaded = true;
          console.log('Successfully loaded all 31 lines from local cache backup!');
        }
      }
    } catch (cacheErr) {
      console.error('Cache fallback error:', cacheErr);
    }
  }

  if (loaded) {
    const savedLineId = localStorage.getItem('abm_selected_line_id');
    let lineToSelect = state.allLines.find(l => l.id == savedLineId);
    if (!lineToSelect) {
      lineToSelect = state.allLines.find(l => l.codigo.includes('09 SAIDA')) || state.allLines[0];
    }
    if (lineToSelect) {
      selectLine(lineToSelect);
    }
  } else {
    showToast('Não foi possível carregar as linhas. Verifique se o servidor está ativo.');
  }
}

// Select line
async function selectLine(line, targetStopIdx = null) {
  state.currentLine = line;
  localStorage.setItem('abm_selected_line_id', line.id);
  document.getElementById('header-line-name').innerText = line.codigo;
  const miniLine = document.getElementById('mini-line-code'); if (miniLine) miniLine.innerText = line.codigo;
  document.getElementById('modal-lines').classList.add('hidden');

  stopTracking();
  stopSimulation();

  let detailsLoaded = false;

  // 1. Immediately render complete curved road polyline if available in cache
  if (line.cachedDetails && line.cachedDetails.desenhoRota && line.cachedDetails.desenhoRota.length > 0) {
    state.lineDetails = line.cachedDetails;
    detailsLoaded = true;
    renderRouteAndStops();
    populateStopSelector(targetStopIdx);
    startTracking();
  }

  // 1. Try API first
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`/api/get_line_details.php?hash=${state.hash}&id=${line.id}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const details = await res.json();
      if (details && (details.pontosDeParada || details.desenhoRota)) {
        state.lineDetails = details;
        detailsLoaded = true;
      }
    }
  } catch (err) {
    console.warn('API get_line_details failed, checking cache...', err);
  }

  // 2. Fallback to cached details if API failed
  if (!detailsLoaded && line.cachedDetails) {
    state.lineDetails = line.cachedDetails;
    detailsLoaded = true;
  }

  if (detailsLoaded) {
    renderRouteAndStops();
    populateStopSelector(targetStopIdx);
    startTracking();
  } else {
    showToast('Carregando itinerário simplificado...');
  }
}

// Render polyline and stops
function renderRouteAndStops() {
  if (!map || !state.lineDetails) return;

  if (routePolyline) map.removeLayer(routePolyline);
  stopMarkers.forEach(m => map.removeLayer(m));
  stopMarkers = [];

  const rawRoute = state.lineDetails.desenhoRota || [];
  const coords = rawRoute.map(pt => [parseFloat(pt.latitude), parseFloat(pt.longitude)]);

  if (coords.length > 0) {
    routePolyline = L.polyline(coords, {
      color: '#38bdf8',
      weight: 6,
      opacity: 0.9,
      lineJoin: 'round'
    }).addTo(map);

    if (!state.searchedLocation) {
      map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });
    }
  }

  const stops = state.lineDetails.pontosDeParada || [];
  document.getElementById('itinerary-count').innerText = stops.length;

  stops.forEach((p, idx) => {
    const lat = parseFloat(p.latitude);
    const lng = parseFloat(p.longitude);
    if (!lat || !lng) return;

    const isTarget = idx === state.targetStopIndex;
    const icon = L.divIcon({
      className: `stop-marker-icon ${isTarget ? 'target-stop' : ''}`,
      html: `<span>${idx + 1}</span>`,
      iconSize: isTarget ? [28, 28] : [22, 22],
      iconAnchor: isTarget ? [14, 14] : [11, 11]
    });

    const marker = L.marker([lat, lng], { icon })
      .addTo(map)
      .bindPopup(`<b>Parada ${idx + 1}: ${p.descricao || 'Ponto'}</b><br>Horário de tabela: <b>${p.horario || '--:--'}</b><br>${p.endereco}`);

    marker.on('click', () => setTargetStop(idx));
    stopMarkers.push(marker);
  });

  renderItineraryList();
}

function populateStopSelector(preferredIdx = null) {
  const sel = document.getElementById('stop-selector');
  sel.innerHTML = '';
  const stops = (state.lineDetails && state.lineDetails.pontosDeParada) || [];

  stops.forEach((p, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.text = `${idx + 1}. [Tabela: ${p.horario || '--:--'}] ${p.descricao || p.endereco.split('-')[0].trim()}`;
    sel.appendChild(opt);
  });

  if (preferredIdx !== null && stops[preferredIdx]) {
    setTargetStop(preferredIdx);
    return;
  }

  const savedStopIndex = localStorage.getItem(`abm_target_stop_${state.currentLine.id}`);
  if (savedStopIndex !== null && stops[savedStopIndex]) {
    setTargetStop(parseInt(savedStopIndex, 10));
  } else if (state.userLocation) {
    let closestIdx = 0;
    let minDist = Infinity;
    stops.forEach((p, idx) => {
      const d = haversineMeters(state.userLocation.lat, state.userLocation.lng, parseFloat(p.latitude), parseFloat(p.longitude));
      if (d < minDist) {
        minDist = d;
        closestIdx = idx;
      }
    });
    setTargetStop(closestIdx);
  } else {
    setTargetStop(Math.min(1, stops.length - 1));
  }

  sel.value = state.targetStopIndex;
}

function setTargetStop(idx) {
  state.targetStopIndex = idx;
  localStorage.setItem(`abm_target_stop_${state.currentLine.id}`, idx);
  document.getElementById('stop-selector').value = idx;

  const stops = (state.lineDetails && state.lineDetails.pontosDeParada) || [];
  const targetStop = stops[idx];
  if (targetStop) {
    document.getElementById('stop-scheduled-hint').innerText = `Tabela: ${targetStop.horario || '--:--'}`;
    updateWalkingPathToTargetStop(targetStop);

    // Update Google Maps Walking link
    const originLat = state.searchedLocation ? state.searchedLocation.lat : (state.userLocation ? state.userLocation.lat : null);
    const originLon = state.searchedLocation ? state.searchedLocation.lon : (state.userLocation ? state.userLocation.lng : null);
    const walkRow = document.getElementById('gmaps-walk-row');
    const walkLink = document.getElementById('gmaps-walk-link');

    if (originLat && originLon) {
      walkRow.style.display = 'block';
      walkLink.href = `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLon}&destination=${targetStop.latitude},${targetStop.longitude}&travelmode=walking`;
    } else {
      walkRow.style.display = 'none';
    }
  }

  stopMarkers.forEach((m, i) => {
    const isTarget = i === idx;
    const icon = L.divIcon({
      className: `stop-marker-icon ${isTarget ? 'target-stop' : ''}`,
      html: `<span>${i + 1}</span>`,
      iconSize: isTarget ? [28, 28] : [22, 22],
      iconAnchor: isTarget ? [14, 14] : [11, 11]
    });
    m.setIcon(icon);
  });

  renderItineraryList();
  recalculateETA();
}

function updateWalkingPathToTargetStop(targetStop) {
  if (!map) return;
  if (walkingPolyline) {
    map.removeLayer(walkingPolyline);
    walkingPolyline = null;
  }

  if (state.searchedLocation && targetStop) {
    const stopCoords = [parseFloat(targetStop.latitude), parseFloat(targetStop.longitude)];
    const destCoords = [state.searchedLocation.lat, state.searchedLocation.lon];

    walkingPolyline = L.polyline([destCoords, stopCoords], {
      color: '#f59e0b',
      weight: 4,
      dashArray: '6, 8',
      opacity: 0.95
    }).addTo(map);

    const bounds = L.latLngBounds([destCoords, stopCoords]);
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 17 });
  }
}

function renderItineraryList(estimatedArrivals = {}) {
  const container = document.getElementById('itinerary-list');
  container.innerHTML = '';
  const stops = (state.lineDetails && state.lineDetails.pontosDeParada) || [];

  stops.forEach((p, idx) => {
    const item = document.createElement('div');
    const isTarget = idx === state.targetStopIndex;
    const estTime = estimatedArrivals[idx];

    let liveBadge = '';
    if (estTime) {
      liveBadge = `<span class="stop-time-badge live">Chega às ${estTime}</span>`;
    }

    item.className = `itinerary-item ${isTarget ? 'target' : ''}`;
    item.innerHTML = `
      <div class="stop-num-badge">${idx + 1}</div>
      <div class="stop-info" style="flex:1;">
        <div style="display:flex;align-items:center;flex-wrap:wrap;">
          <strong>${p.descricao || 'Ponto de Parada'}</strong>
          <span class="stop-time-badge sched">Tabela: ${p.horario}</span>
          ${liveBadge}
        </div>
        <p style="font-size:0.76rem;color:var(--text-muted);margin-top:3px;">${p.endereco}</p>
      </div>
      ${isTarget ? '<span style="color:#f59e0b;font-size:0.72rem;font-weight:800;">DESTINO</span>' : ''}
    `;
    item.addEventListener('click', () => setTargetStop(idx));
    container.appendChild(item);
  });
}

// Vehicle Polling
function startTracking() {
  fetchVehiclePosition();
  state.trackingTimer = setInterval(fetchVehiclePosition, 5000);
}

function stopTracking() {
  if (state.trackingTimer) {
    clearInterval(state.trackingTimer);
    state.trackingTimer = null;
  }
}

async function fetchVehiclePosition() {
  if (state.simulating || !state.currentLine) return;

  const url = `/api/get_vehicle_position.php?hash=${state.hash}&id=${state.currentLine.id}&codigo=${encodeURIComponent(state.currentLine.codigo)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();

    const dot = document.getElementById('global-status-dot');
    const pill = document.getElementById('eta-status-pill');

    if (data.vehicle_active && data.posicao) {
      state.busActive = true;
      dot.className = 'pulse-indicator status-active';
      pill.className = 'eta-status-pill active';
      pill.innerText = 'Em trânsito';

      state.busLocation = {
        lat: parseFloat(data.posicao.latitude),
        lng: parseFloat(data.posicao.longitude),
        speed: data.velocidade || 0
      };

      updateBusMarker(state.busLocation.lat, state.busLocation.lng, data.veiculo);
      recalculateETA();
    } else {
      state.busActive = false;
      dot.className = 'pulse-indicator status-offline';
      pill.className = 'eta-status-pill';
      pill.innerText = 'Fora de rota';
      resetETADisplay();
    }
  } catch (err) {
    console.error('Polling error:', err);
  }
}

function updateBusMarker(lat, lng, veiculo) {
  if (!map) return;
  const latLng = [lat, lng];

  if (!busMarker) {
    const icon = L.divIcon({
      className: 'bus-marker-icon',
      html: '🚌',
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });
    busMarker = L.marker(latLng, { icon, zIndexOffset: 1000 }).addTo(map);
  } else {
    busMarker.setLatLng(latLng);
  }

  const veiculoInfo = veiculo ? `<br>Veículo: ${veiculo.numero} (${veiculo.placa})` : '';
  busMarker.bindPopup(`<b>Ônibus em Movimento</b>${veiculoInfo}`);
}

// -------------------------------------------------------------
// TRAFFIC-SYNCHRONIZED ETA & CLOCK TIME CALCULATION
// -------------------------------------------------------------
async function recalculateETA() {
  if (!state.busLocation || !state.lineDetails) return;

  const route = state.lineDetails.desenhoRota || [];
  const stops = state.lineDetails.pontosDeParada || [];
  if (route.length < 2 || stops.length === 0) return;

  const targetStop = stops[state.targetStopIndex];
  if (!targetStop) return;

  const targetLat = parseFloat(targetStop.latitude);
  const targetLng = parseFloat(targetStop.longitude);

  let busIdx = 0;
  let minBusDist = Infinity;
  for (let i = 0; i < route.length; i++) {
    const d = haversineMeters(state.busLocation.lat, state.busLocation.lng, parseFloat(route[i].latitude), parseFloat(route[i].longitude));
    if (d < minBusDist) {
      minBusDist = d;
      busIdx = i;
    }
  }

  let stopIdx = 0;
  let minStopDist = Infinity;
  for (let i = 0; i < route.length; i++) {
    const d = haversineMeters(targetLat, targetLng, parseFloat(route[i].latitude), parseFloat(route[i].longitude));
    if (d < minStopDist) {
      minStopDist = d;
      stopIdx = i;
    }
  }

  const pill = document.getElementById('eta-status-pill');
  const clockDisplay = document.getElementById('eta-clock-display');
  const countdownText = document.getElementById('eta-countdown');
  const diffBadge = document.getElementById('eta-diff-badge');

  if (busIdx > stopIdx + 4) {
    clockDisplay.innerText = 'Já passou';
    countdownText.innerText = 'Ônibus já ultrapassou o seu ponto';
    document.getElementById('metric-distance').innerText = '0.0 km';
    document.getElementById('metric-stops').innerText = '0';
    pill.className = 'eta-status-pill warning';
    pill.innerText = 'Ponto ultrapassado';
    diffBadge.classList.add('hidden');
    return;
  }

  let cumulativeMeters = 0;
  for (let i = busIdx; i < stopIdx; i++) {
    cumulativeMeters += haversineMeters(
      parseFloat(route[i].latitude), parseFloat(route[i].longitude),
      parseFloat(route[i + 1].latitude), parseFloat(route[i + 1].longitude)
    );
  }

  let stopsRemaining = 0;
  stops.forEach((p, idx) => {
    if (idx <= state.targetStopIndex && idx >= Math.floor((busIdx / route.length) * stops.length)) {
      stopsRemaining++;
    }
  });

  const distKm = (cumulativeMeters / 1000).toFixed(1);

  const now = Date.now();
  if (now - state.lastTrafficSync > 12000) {
    state.lastTrafficSync = now;
    fetchTrafficDuration(state.busLocation.lat, state.busLocation.lng, targetLat, targetLng);
  }

  let travelSeconds = 0;
  if (state.cachedTrafficDurationSeconds) {
    travelSeconds = state.cachedTrafficDurationSeconds;
  } else {
    const effSpeedKmh = Math.max(20, Math.min(65, (state.busLocation.speed || 30)));
    travelSeconds = (cumulativeMeters / (effSpeedKmh * 1000 / 3600));
  }

  const dwellSeconds = Math.max(0, stopsRemaining - 1) * 40;
  const totalSeconds = travelSeconds + dwellSeconds;
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));

  const arrivalDate = new Date(now + totalSeconds * 1000);
  const hours = String(arrivalDate.getHours()).padStart(2, '0');
  const minutes = String(arrivalDate.getMinutes()).padStart(2, '0');
  const arrivalClockTime = `${hours}:${minutes}`;

  clockDisplay.innerText = arrivalClockTime;
  const miniClock = document.getElementById('mini-clock-display'); if (miniClock) miniClock.innerText = arrivalClockTime;
  countdownText.innerText = `Chega em ~${totalMinutes} min • ${distKm} km na rota`;
  const miniCd = document.getElementById('mini-countdown-display'); if (miniCd) miniCd.innerText = `Chega em ~${totalMinutes} min (${distKm} km)`;
  document.getElementById('metric-distance').innerText = `${distKm} km`;
  document.getElementById('metric-speed').innerText = `${Math.round(state.busLocation.speed || 30)} km/h`;
  document.getElementById('metric-stops').innerText = `${stopsRemaining}`;

  if (targetStop.horario && targetStop.horario.includes(':')) {
    diffBadge.classList.remove('hidden');
    const [schedH, schedM] = targetStop.horario.split(':').map(Number);
    const schedMinutesToday = schedH * 60 + schedM;
    const arrMinutesToday = arrivalDate.getHours() * 60 + arrivalDate.getMinutes();
    const diff = arrMinutesToday - schedMinutesToday;

    if (diff > 2) {
      diffBadge.className = 'eta-diff-badge delay';
      diffBadge.innerText = `+${diff} min atrasado`;
    } else if (diff < -2) {
      diffBadge.className = 'eta-diff-badge on-time';
      diffBadge.innerText = `${Math.abs(diff)} min adiantado`;
    } else {
      diffBadge.className = 'eta-diff-badge on-time';
      diffBadge.innerText = 'No horário da tabela';
    }
  }

  const estimatedArrivals = {};
  stops.forEach((p, idx) => {
    if (idx >= state.targetStopIndex) {
      const stopRatio = (idx - state.targetStopIndex + 1);
      const estDate = new Date(arrivalDate.getTime() + (stopRatio * 2.5 * 60000));
      estimatedArrivals[idx] = `${String(estDate.getHours()).padStart(2, '0')}:${String(estDate.getMinutes()).padStart(2, '0')}`;
    } else if (idx === state.targetStopIndex) {
      estimatedArrivals[idx] = arrivalClockTime;
    }
  });
  renderItineraryList(estimatedArrivals);

  if (totalMinutes <= 5 && !state.alertTriggeredForTrip) {
    state.alertTriggeredForTrip = true;
    playChime();
    showToast(`⚠️ O fretado está próximo! Chega às ${arrivalClockTime} (~${totalMinutes} min).`);
  }
}

async function fetchTrafficDuration(fLat, fLon, tLat, tLon) {
  try {
    const keyParam = state.googleApiKey ? `&google_key=${encodeURIComponent(state.googleApiKey)}` : '';
    const res = await fetch(`/api/traffic-eta?from=${fLat},${fLon}&to=${tLat},${tLon}${keyParam}`);
    const data = await res.json();
    if (data.duration_seconds) {
      state.cachedTrafficDurationSeconds = data.duration_seconds;
      const trafficPill = document.getElementById('traffic-badge-text');
      trafficPill.innerText = `Trânsito sincronizado (${data.provider})`;
    }
  } catch (e) {
    console.log('Traffic fetch error:', e);
  }
}

function resetETADisplay() {
  const targetStop = state.lineDetails && state.lineDetails.pontosDeParada && state.lineDetails.pontosDeParada[state.targetStopIndex];
  const schedTime = (targetStop && targetStop.horario) || '--:--';

  document.getElementById('eta-clock-display').innerText = schedTime;
  const miniResetClock = document.getElementById('mini-clock-display'); if (miniResetClock) miniResetClock.innerText = schedTime;
  document.getElementById('eta-countdown').innerText = 'Horário de tabela (Ônibus fora de rota)';
  const miniResetCd = document.getElementById('mini-countdown-display'); if (miniResetCd) miniResetCd.innerText = 'Tabela (Fora de rota)';
  document.getElementById('metric-distance').innerText = '-- km';
  document.getElementById('metric-speed').innerText = '-- km/h';
  document.getElementById('metric-stops').innerText = '--';
  document.getElementById('eta-diff-badge').classList.add('hidden');
}

// -------------------------------------------------------------
// ADDRESS SEARCH & CLOSEST BUS DISCOVERY ENGINE
// -------------------------------------------------------------
let geocodeDebounce = null;
let currentRankedResults = [];

function setupAddressFinder() {
  const mainInput = document.getElementById('main-addr-input');
  const clearBtn = document.getElementById('btn-clear-main-search');
  const autoBox = document.getElementById('main-autocomplete-box');
  const submitBtn = document.getElementById('btn-submit-main-search');
  const gpsBtn = document.getElementById('btn-gps-main-search');
  const pickMapBtn = document.getElementById('btn-main-pick-map');
  const cancelPickBtn = document.getElementById('btn-cancel-pick');

  // Floating card elements
  const closeCardBtn = document.getElementById('btn-close-closest-card');
  const viewAllBtn = document.getElementById('btn-view-all-ranked');

  // Modal ranked elements
  const closeRankedModalBtn = document.getElementById('btn-close-ranked-modal');

  // 1. Main Search Input typing (Autocomplete)
  if (mainInput) {
    mainInput.addEventListener('input', () => {
      const val = mainInput.value.trim();
      if (clearBtn) clearBtn.classList.toggle('hidden', val.length === 0);

      if (geocodeDebounce) clearTimeout(geocodeDebounce);
      if (val.length < 3) {
        if (autoBox) autoBox.classList.add('hidden');
        return;
      }

      geocodeDebounce = setTimeout(() => {
        fetchAddressSuggestions(val);
      }, 350);
    });

    // Enter key to search
    mainInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeSearch();
      }
    });
  }

  // 2. Submit Button
  if (submitBtn) {
    submitBtn.addEventListener('click', executeSearch);
  }

  function executeSearch() {
    if (!mainInput) return;
    const val = mainInput.value.trim();
    if (!val) {
      showToast('Digite um endereço, local ou coordenadas.');
      return;
    }
    if (autoBox) autoBox.classList.add('hidden');
    resolveAndFind(val);
  }

  // 3. Clear Button
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (mainInput) mainInput.value = '';
      clearBtn.classList.add('hidden');
      if (autoBox) autoBox.classList.add('hidden');
      clearSearchedAddress();
    });
  }

  // 4. GPS Button
  if (gpsBtn) {
    gpsBtn.addEventListener('click', () => {
      if (state.userLocation) {
        if (mainInput) mainInput.value = 'Minha Localização GPS';
        if (clearBtn) clearBtn.classList.remove('hidden');
        if (autoBox) autoBox.classList.add('hidden');
        findClosestLines(state.userLocation.lat, state.userLocation.lng, 'Minha Localização GPS');
      } else {
        showToast('📍 Buscando sua localização pelo GPS...');
        if ('geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            pos => {
              state.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
              updateUserMarker();
              if (mainInput) mainInput.value = 'Minha Localização GPS';
              if (clearBtn) clearBtn.classList.remove('hidden');
              findClosestLines(state.userLocation.lat, state.userLocation.lng, 'Minha Localização GPS');
            },
            err => showToast('Não foi possível obter GPS: ' + err.message),
            { enableHighAccuracy: true, timeout: 10000 }
          );
        } else {
          showToast('Geolocalização não disponível neste dispositivo.');
        }
      }
    });
  }

  // 5. Direction Chips (SAIDA, ENTRADA, ALL)
  document.querySelectorAll('[data-search-dir]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-search-dir]').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      state.addrDirection = e.currentTarget.dataset.searchDir;
      if (state.searchedLocation) {
        findClosestLines(state.searchedLocation.lat, state.searchedLocation.lon, state.searchedLocation.name);
      }
    });
  });

  // 6. Map Picker Buttons
  if (pickMapBtn) pickMapBtn.addEventListener('click', startPickingOnMap);
  if (cancelPickBtn) cancelPickBtn.addEventListener('click', stopPickingOnMap);

  // 7. Closest Match Card Actions
  if (closeCardBtn) {
    closeCardBtn.addEventListener('click', () => {
      const card = document.getElementById('closest-match-card');
      if (card) card.classList.add('hidden');
    });
  }

  if (viewAllBtn) {
    viewAllBtn.addEventListener('click', () => {
      openRankedLinesModal();
    });
  }

  // 8. Ranked Modal Close
  if (closeRankedModalBtn) {
    closeRankedModalBtn.addEventListener('click', () => {
      const modal = document.getElementById('modal-ranked-lines');
      if (modal) modal.classList.add('hidden');
    });
  }
}

async function resolveAndFind(queryText) {
  showToast(`🔍 Buscando "${queryText}"...`);

  try {
    const keyParam = state.googleApiKey ? `&google_key=${encodeURIComponent(state.googleApiKey)}` : '';
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(queryText)}${keyParam}`);
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      showToast('❌ Endereço não localizado. Tente incluir "Campinas" ou use 🎯 Tocar no Mapa.');
      return;
    }

    const first = data[0];
    const mainInput = document.getElementById('main-addr-input');
    if (mainInput) mainInput.value = first.name;
    const clearBtn = document.getElementById('btn-clear-main-search');
    if (clearBtn) clearBtn.classList.remove('hidden');

    findClosestLines(first.lat, first.lon, first.name);
  } catch (err) {
    console.error('Resolve address error:', err);
    showToast('⚠️ Erro ao consultar serviço de busca de endereços.');
  }
}

async function fetchAddressSuggestions(query) {
  const autoBox = document.getElementById('main-autocomplete-box');
  if (!autoBox) return;

  try {
    const keyParam = state.googleApiKey ? `&google_key=${encodeURIComponent(state.googleApiKey)}` : '';
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}${keyParam}`);
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      autoBox.classList.add('hidden');
      return;
    }

    autoBox.innerHTML = '';
    data.forEach(item => {
      const el = document.createElement('div');
      el.className = 'autocomplete-item';
      el.innerHTML = `
        <div class="autocomplete-name">📍 ${item.name}</div>
        <div class="autocomplete-sub">${item.display}</div>
      `;
      el.addEventListener('click', () => {
        const mainInput = document.getElementById('main-addr-input');
        if (mainInput) mainInput.value = item.name;
        const clearBtn = document.getElementById('btn-clear-main-search');
        if (clearBtn) clearBtn.classList.remove('hidden');
        autoBox.classList.add('hidden');
        findClosestLines(item.lat, item.lon, item.name);
      });
      autoBox.appendChild(el);
    });

    autoBox.classList.remove('hidden');
  } catch (err) {
    console.error('Geocode suggestions error:', err);
  }
}

async function findClosestLines(lat, lon, placeName) {
  state.searchedLocation = { lat, lon, name: placeName };
  setSearchedDestinationMarker(lat, lon, placeName);

  showToast('⚡ Calculando distâncias para os fretados...');

  try {
    const dir = state.addrDirection || 'SAIDA';
    const url = `/api/find-closest-lines?lat=${lat}&lon=${lon}&direction=${dir}&hash=${state.hash}`;
    const res = await fetch(url);
    const ranked = await res.json();

    if (!Array.isArray(ranked) || ranked.length === 0) {
      showToast('Nenhum fretado encontrado para este sentido.');
      return;
    }

    currentRankedResults = ranked;
    const best = ranked[0];

    // Populate and show the Best Match Floating Card
    displayClosestCard(best);

    // Auto-select the #1 best line and its closest stop
    const lineObj = state.allLines.find(l => l.id == best.line_id) || {
      id: best.line_id,
      codigo: best.codigo,
      nome: best.nome
    };
    selectLine(lineObj, best.closest_stop.stop_index);

    const distStr = best.min_distance_meters < 1000 
      ? `${Math.round(best.min_distance_meters)}m` 
      : `${best.min_distance_km}km`;

    showToast(`🏆 Mais próximo: ${best.codigo} (${distStr} - ~${best.walking_minutes} min a pé)`);
  } catch (err) {
    console.error('Find closest lines error:', err);
    showToast('⚠️ Erro ao calcular linhas mais próximas.');
  }
}

function displayClosestCard(item) {
  const card = document.getElementById('closest-match-card');
  if (!card) return;

  const stop = item.closest_stop;
  const distStr = item.min_distance_meters < 1000 
    ? `${Math.round(item.min_distance_meters)}m` 
    : `${item.min_distance_km}km`;

  const codeEl = document.getElementById('closest-card-code');
  const distEl = document.getElementById('closest-card-dist');
  const walkEl = document.getElementById('closest-card-walk');
  const timeEl = document.getElementById('closest-card-time');
  const stopNumEl = document.getElementById('closest-card-stop-num');
  const stopAddrEl = document.getElementById('closest-card-stop-addr');
  const gmapsLinkEl = document.getElementById('closest-card-gmaps-link');

  if (codeEl) codeEl.innerText = `${item.codigo} ${item.nome && item.nome !== item.codigo ? ' - ' + item.nome : ''}`;
  if (distEl) distEl.innerText = distStr;
  if (walkEl) walkEl.innerText = `~${item.walking_minutes} min`;
  if (timeEl) timeEl.innerText = stop.horario || '--:--';
  if (stopNumEl) stopNumEl.innerText = `Parada nº ${stop.stop_index + 1}`;
  if (stopAddrEl) stopAddrEl.innerText = stop.endereco || stop.descricao || 'Ponto no itinerário';
  if (gmapsLinkEl) gmapsLinkEl.href = item.google_maps_walk_url;

  card.classList.remove('hidden');
}

function openRankedLinesModal() {
  const modal = document.getElementById('modal-ranked-lines');
  const container = document.getElementById('modal-ranked-cards-container');
  if (!modal || !container) return;

  container.innerHTML = '';

  if (currentRankedResults.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">Nenhuma busca realizada ainda.</p>';
    modal.classList.remove('hidden');
    return;
  }

  currentRankedResults.forEach((item, index) => {
    const card = document.createElement('div');
    const isBest = index === 0;
    card.className = `ranked-card ${isBest ? 'best-match' : ''}`;

    const stop = item.closest_stop;
    const walkMin = item.walking_minutes;
    const distStr = item.min_distance_meters < 1000 
      ? `${Math.round(item.min_distance_meters)} metros` 
      : `${item.min_distance_km} km`;

    card.innerHTML = `
      <div class="ranked-header">
        <div class="ranked-line-code">
          <span>#${index + 1}</span>
          <span>${item.codigo}</span>
          ${isBest ? '<span class="ranked-badge-best">Mais Próximo</span>' : ''}
        </div>
        <div class="ranked-dist">${distStr}</div>
      </div>
      <div class="ranked-details">
        <div>🚶‍♂️ Aprox. <strong>~${walkMin} min a pé</strong> até o ponto</div>
        <div style="margin-top:4px;">Parada ${stop.stop_index + 1}: <span class="ranked-stop-highlight">${stop.endereco || stop.descricao}</span></div>
      </div>
      <div class="ranked-footer">
        <span class="ranked-sched">Horário da Parada: <strong>${stop.horario || '--:--'}</strong></span>
        <div class="ranked-actions-group">
          <a href="${item.google_maps_walk_url}" target="_blank" class="btn-gmaps-direct" onclick="event.stopPropagation()">
            🗺️ Google Maps
          </a>
          <button class="btn-select-ranked btn-view-line">Ver no Mapa &rarr;</button>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      selectRankedLine(item);
    });

    const viewBtn = card.querySelector('.btn-view-line');
    if (viewBtn) {
      viewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectRankedLine(item);
      });
    }

    container.appendChild(card);
  });

  modal.classList.remove('hidden');
}

function selectRankedLine(rankedItem) {
  const modal = document.getElementById('modal-ranked-lines');
  if (modal) modal.classList.add('hidden');

  const lineObj = state.allLines.find(l => l.id == rankedItem.line_id) || {
    id: rankedItem.line_id,
    codigo: rankedItem.codigo,
    nome: rankedItem.nome
  };

  displayClosestCard(rankedItem);
  selectLine(lineObj, rankedItem.closest_stop.stop_index);

  const distLabel = rankedItem.min_distance_meters < 1000 
    ? `${Math.round(rankedItem.min_distance_meters)}m` 
    : `${rankedItem.min_distance_km}km`;

  showToast(`✅ ${rankedItem.codigo} selecionada! Ponto a ${distLabel} de distância.`);
}

function setSearchedDestinationMarker(lat, lon, name) {
  if (!map) return;
  if (destinationMarker) map.removeLayer(destinationMarker);

  const icon = L.divIcon({
    className: 'destination-marker-icon',
    html: '🎯',
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });

  destinationMarker = L.marker([lat, lon], { icon, zIndexOffset: 950 })
    .addTo(map)
    .bindPopup(`<b>Seu Local Selecionado:</b><br>${name}`)
    .openPopup();
}

function clearSearchedAddress() {
  state.searchedLocation = null;
  currentRankedResults = [];

  const card = document.getElementById('closest-match-card');
  if (card) card.classList.add('hidden');

  const mainInput = document.getElementById('main-addr-input');
  if (mainInput) mainInput.value = '';

  const clearBtn = document.getElementById('btn-clear-main-search');
  if (clearBtn) clearBtn.classList.add('hidden');

  if (destinationMarker) {
    map.removeLayer(destinationMarker);
    destinationMarker = null;
  }
  if (walkingPolyline) {
    map.removeLayer(walkingPolyline);
    walkingPolyline = null;
  }
  if (routePolyline) {
    map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });
  }
  showToast('Busca de endereço limpa.');
}

// -------------------------------------------------------------
// SIMULATION MODE
// -------------------------------------------------------------
function toggleSimulation() {
  if (state.simulating) {
    stopSimulation();
  } else {
    startSimulation();
  }
}

function startSimulation() {
  if (!state.lineDetails || !state.lineDetails.desenhoRota) {
    showToast('Carregue uma linha antes de iniciar a simulação.');
    return;
  }

  stopTracking();
  state.simulating = true;
  state.alertTriggeredForTrip = false;
  state.simIndex = 0;

  const simBanner = document.getElementById('sim-banner');
  if (simBanner) simBanner.classList.remove('hidden');

  const dot = document.getElementById('global-status-dot');
  if (dot) dot.className = 'pulse-indicator status-simulating';

  const pill = document.getElementById('eta-status-pill');
  if (pill) {
    pill.className = 'eta-status-pill active';
    pill.innerText = 'Simulação ativa';
  }

  showToast('🎮 Modo Simulação ativo! Ônibus em trânsito pela rota.');

  const route = state.lineDetails.desenhoRota;

  state.simInterval = setInterval(() => {
    if (state.simIndex >= route.length) {
      stopSimulation();
      showToast('Fim da simulação.');
      return;
    }

    const pt = route[state.simIndex];
    state.busLocation = {
      lat: parseFloat(pt.latitude),
      lng: parseFloat(pt.longitude),
      speed: 38 + Math.floor(Math.random() * 12)
    };

    updateBusMarker(state.busLocation.lat, state.busLocation.lng, { numero: 'SIM-01', placa: 'DEMO-2026' });
    recalculateETA();

    state.simIndex += 4;
  }, 1000);
}

function stopSimulation() {
  if (state.simInterval) {
    clearInterval(state.simInterval);
    state.simInterval = null;
  }
  state.simulating = false;

  const simBanner = document.getElementById('sim-banner');
  if (simBanner) simBanner.classList.add('hidden');

  const dot = document.getElementById('global-status-dot');
  if (dot) dot.className = 'pulse-indicator status-offline';

  const pill = document.getElementById('eta-status-pill');
  if (pill) {
    pill.className = 'eta-status-pill';
    pill.innerText = 'Fora de rota';
  }

  resetETADisplay();
  startTracking();
}

function renderLinesModal() {
  const container = document.getElementById('lines-list-container');
  if (!container) return;
  container.innerHTML = '';

  const searchInput = document.getElementById('lines-search-input');
  const search = (searchInput ? searchInput.value : '').toLowerCase();

  const filtered = state.allLines.filter(l => {
    const matchesDir = l.codigo.toUpperCase().includes(state.currentDirection);
    const matchesSearch = l.codigo.toLowerCase().includes(search) || l.nome.toLowerCase().includes(search);
    return matchesDir && matchesSearch;
  });

  filtered.forEach(line => {
    const card = document.createElement('div');
    const isSelected = state.currentLine && state.currentLine.id === line.id;
    card.className = `line-card ${isSelected ? 'active' : ''}`;
    card.innerHTML = `
      <div>
        <strong>${line.codigo}</strong>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">${line.nome}</p>
        ${line.horainicial ? `<span style="font-size:0.72rem;color:var(--accent-blue);">Horário: ${line.horainicial} - ${line.horafinal}</span>` : ''}
      </div>
      <span style="font-size:1.2rem;color:var(--text-muted);">&#8250;</span>
    `;
    card.addEventListener('click', () => selectLine(line));
    container.appendChild(card);
  });
}

function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}


function toggleSheetMinimize(forceState) {
  const sheet = document.getElementById('bottom-sheet');
  const toggleIcon = document.getElementById('sheet-toggle-icon');
  const toggleLabel = document.getElementById('sheet-toggle-label');
  if (!sheet) return;

  const willMinimize = (forceState !== undefined) ? forceState : !sheet.classList.contains('minimized');

  if (willMinimize) {
    sheet.classList.add('minimized');
    document.body.classList.add('sheet-is-minimized');
    if (toggleIcon) toggleIcon.innerText = '▲';
    if (toggleLabel) toggleLabel.innerText = 'Expandir';
    state.sheetMinimized = true;
    localStorage.setItem('abm_sheet_minimized', 'true');
  } else {
    sheet.classList.remove('minimized');
    document.body.classList.remove('sheet-is-minimized');
    if (toggleIcon) toggleIcon.innerText = '▼';
    if (toggleLabel) toggleLabel.innerText = 'Minimizar';
    state.sheetMinimized = false;
    localStorage.setItem('abm_sheet_minimized', 'false');
  }
}

function toggleZenMode() {
  state.zenMode = !state.zenMode;
  const exitPill = document.getElementById('btn-exit-zen');

  if (state.zenMode) {
    document.body.classList.add('zen-mode');
    if (exitPill) exitPill.classList.remove('hidden');
    showToast('🗺️ Modo Mapa Limpo ativado! Toque no botão inferior para restaurar.');
  } else {
    document.body.classList.remove('zen-mode');
    if (exitPill) exitPill.classList.add('hidden');
    showToast('Painéis restaurados.');
  }

  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 350);
}

function setupEvents() {
  // Top header line button
  safeAddListener('btn-open-lines', 'click', () => {
    renderLinesModal();
    const modal = document.getElementById('modal-lines');
    if (modal) modal.classList.remove('hidden');
  });

  safeAddListener('btn-close-lines', 'click', () => {
    const modal = document.getElementById('modal-lines');
    if (modal) modal.classList.add('hidden');
  });

  // Line selection direction tabs
  document.querySelectorAll('[data-direction]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-direction]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.currentDirection = e.target.dataset.direction;
      renderLinesModal();
    });
  });

  // Lines filter input
  safeAddListener('lines-search-input', 'input', renderLinesModal);

  // Map controls
  safeAddListener('btn-toggle-layer', 'click', () => {
    if (state.mapStyle === 'satellite') {
      switchBaseLayer('streets');
    } else if (state.mapStyle === 'streets') {
      switchBaseLayer('dark');
    } else {
      switchBaseLayer('satellite');
    }
  });

  safeAddListener('btn-toggle-traffic', 'click', toggleTrafficLayer);
  safeAddListener('traffic-badge', 'click', toggleTrafficLayer);

  safeAddListener('btn-center-bus', 'click', () => {
    if (busMarker) {
      map.setView(busMarker.getLatLng(), 16, { animate: true });
    } else {
      showToast('Ônibus ainda não localizado no GPS.');
    }
  });

  safeAddListener('btn-center-user', 'click', () => {
    if (state.userLocation) {
      map.setView([state.userLocation.lat, state.userLocation.lng], 16, { animate: true });
    } else {
      showToast('Aguardando sinal de GPS do seu celular...');
    }
  });

  safeAddListener('btn-center-route', 'click', () => {
    if (routePolyline) {
      map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });
    }
  });

  // Settings modal
  safeAddListener('btn-settings', 'click', () => {
    const cfgHash = document.getElementById('cfg-hash');
    const cfgGoogleKey = document.getElementById('cfg-google-key');
    const cfgMapStyle = document.getElementById('cfg-map-style');
    const cfgTraffic = document.getElementById('cfg-traffic-layer');
    const cfgSound = document.getElementById('cfg-sound-alert');

    if (cfgHash) cfgHash.value = state.hash;
    if (cfgGoogleKey) cfgGoogleKey.value = state.googleApiKey;
    if (cfgMapStyle) cfgMapStyle.value = state.mapStyle;
    if (cfgTraffic) cfgTraffic.checked = state.trafficLayerActive;
    if (cfgSound) cfgSound.checked = state.soundEnabled;

    const modal = document.getElementById('modal-settings');
    if (modal) modal.classList.remove('hidden');
  });

  safeAddListener('btn-close-settings', 'click', () => {
    const modal = document.getElementById('modal-settings');
    if (modal) modal.classList.add('hidden');
  });

  safeAddListener('btn-save-settings', 'click', () => {
    const cfgHash = document.getElementById('cfg-hash');
    const newHash = cfgHash ? cfgHash.value.trim() : '';
    if (newHash) {
      state.hash = newHash;
      localStorage.setItem('abm_hash', newHash);
    }

    const cfgGoogleKey = document.getElementById('cfg-google-key');
    state.googleApiKey = cfgGoogleKey ? cfgGoogleKey.value.trim() : '';
    localStorage.setItem('abm_google_key', state.googleApiKey);

    const cfgMapStyle = document.getElementById('cfg-map-style');
    if (cfgMapStyle) switchBaseLayer(cfgMapStyle.value);

    const cfgTraffic = document.getElementById('cfg-traffic-layer');
    if (cfgTraffic && cfgTraffic.checked !== state.trafficLayerActive) {
      toggleTrafficLayer();
    }

    const cfgSound = document.getElementById('cfg-sound-alert');
    if (cfgSound) {
      state.soundEnabled = cfgSound.checked;
      localStorage.setItem('abm_sound', state.soundEnabled);
    }

    const modal = document.getElementById('modal-settings');
    if (modal) modal.classList.add('hidden');
    showToast('Configurações salvas!');
    loadPublicData();
  });

  // Stop selector
  safeAddListener('stop-selector', 'change', (e) => {
    setTargetStop(parseInt(e.target.value, 10));
  });

  // Itinerary collapsible toggle
  safeAddListener('itinerary-toggle', 'click', () => {
    const list = document.getElementById('itinerary-list');
    const arrow = document.getElementById('itinerary-arrow');
    if (list) {
      const isHidden = list.classList.toggle('hidden');
      if (arrow) arrow.innerText = isHidden ? '▲' : '▼';
    }
  });

  // Simulation controls
  safeAddListener('btn-toggle-simulation', 'click', toggleSimulation);
  safeAddListener('btn-stop-sim', 'click', stopSimulation);

  
  // Bottom Sheet minimize toggle
  safeAddListener('btn-sheet-toggle', 'click', (e) => {
    e.stopPropagation();
    toggleSheetMinimize();
  });

  safeAddListener('sheet-handle', 'click', () => {
    toggleSheetMinimize();
  });

  safeAddListener('sheet-mini-summary', 'click', (e) => {
    if (e.target.closest('#btn-sheet-toggle')) return;
    toggleSheetMinimize();
  });

  // Mobile Touch Gestures for bottom sheet (Swipe down to minimize, swipe up to expand)
  const sheetHandle = document.getElementById('sheet-handle');
  const sheetMini = document.getElementById('sheet-mini-summary');
  let touchStartY = 0;

  function handleSheetTouchStart(e) {
    if (e.touches && e.touches.length > 0) {
      touchStartY = e.touches[0].clientY;
    }
  }

  function handleSheetTouchEnd(e) {
    if (e.changedTouches && e.changedTouches.length > 0) {
      const touchEndY = e.changedTouches[0].clientY;
      const diff = touchEndY - touchStartY;
      if (diff > 35) {
        toggleSheetMinimize(true);
      } else if (diff < -35) {
        toggleSheetMinimize(false);
      }
    }
  }

  if (sheetHandle) {
    sheetHandle.addEventListener('touchstart', handleSheetTouchStart, { passive: true });
    sheetHandle.addEventListener('touchend', handleSheetTouchEnd, { passive: true });
  }
  if (sheetMini) {
    sheetMini.addEventListener('touchstart', handleSheetTouchStart, { passive: true });
    sheetMini.addEventListener('touchend', handleSheetTouchEnd, { passive: true });
  }

  // Zen Mode Controls
  safeAddListener('btn-toggle-zen', 'click', toggleZenMode);
  safeAddListener('btn-exit-zen', 'click', toggleZenMode);

  // Restore saved minimize state
  if (state.sheetMinimized) {
    toggleSheetMinimize(true);
  }

  // Address finder
  setupAddressFinder();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW err:', err));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupEvents();
  loadPublicData();
});
