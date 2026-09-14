from http.server import BaseHTTPRequestHandler
import urllib.request
import urllib.parse
import json
import os
import math
import re
import time

TARGET_API = "https://abmtecnologia.com.br/gerador_links/api"
lines_cache = {}

def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371000
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def get_cached_lines(hash_code):
    global lines_cache
    if hash_code in lines_cache:
        return lines_cache[hash_code]

    # Search in multiple potential locations on Vercel
    candidates = [
        f"cache_lines_{hash_code}.json",
        os.path.join(os.path.dirname(__file__), f"cache_lines_{hash_code}.json"),
        os.path.join(os.path.dirname(__file__), "..", f"cache_lines_{hash_code}.json")
    ]

    for cache_file in candidates:
        if os.path.exists(cache_file):
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    lines_cache[hash_code] = data
                    return data
            except Exception as e:
                print("Error loading cache file:", e)

    # If no cache file found, try fetching from remote API
    try:
        url_lines = f"{TARGET_API}/get_public_link_data.php?hash={hash_code}"
        req = urllib.request.Request(url_lines, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        lines = []
        for g in data.get('grupos', []):
            for l in g.get('lines', []):
                full_info = (data.get('full_lines_data') or {}).get(l.get('codigo'), {})
                lines.append({
                    'id': l.get('id'),
                    'codigo': l.get('codigo'),
                    'nome': full_info.get('linha') or l.get('codigo'),
                    'sentido': 'SAIDA' if 'SAIDA' in l.get('codigo', '').upper() else 'ENTRADA',
                    'horainicial': full_info.get('horainicial', ''),
                    'horafinal': full_info.get('horafinal', '')
                })

        for line in lines:
            line_id = line['id']
            u = f"{TARGET_API}/get_line_details.php?hash={hash_code}&id={line_id}"
            r = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
            try:
                with urllib.request.urlopen(r, timeout=8) as res:
                    details = json.loads(res.read().decode('utf-8'))
                    line['pontos'] = details.get('pontosDeParada', [])
            except Exception:
                line['pontos'] = []

        lines_cache[hash_code] = lines
        return lines
    except Exception as e:
        print("Error populating cache:", e)
        return []

class handler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, User-Agent')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        # 1. Geocode endpoint (Address / Google Maps URL to Lat/Lon)
        if '/api/geocode' in self.path:
            self.handle_geocode()
            return

        # 2. Find Closest Lines to coordinate
        if '/api/find-closest-lines' in self.path:
            self.handle_find_closest_lines()
            return

        # 3. Live Traffic ETA
        if '/api/traffic-eta' in self.path:
            self.handle_traffic_eta()
            return

                # 4. Handle get_line_details.php directly with complete road polyline
        if 'get_line_details.php' in self.path:
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            line_id = params.get('id', [''])[0]
            hash_code = params.get('hash', ['b10c36fd2123fc0faf30e4524fd65e53'])[0]
            cached_lines = get_cached_lines(hash_code)
            for l in cached_lines:
                if str(l.get('id')) == str(line_id) and l.get('desenhoRota'):
                    self.send_json_response({
                        'id': l['id'],
                        'codigoLinha': l['codigo'],
                        'descricao': l['nome'],
                        'ativa': True,
                        'desenhoRota': l['desenhoRota'],
                        'pontosDeParada': l.get('pontos', [])
                    })
                    return

        # 5. Handle get_public_link_data.php with full lines list
        if 'get_public_link_data.php' in self.path:
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            hash_code = params.get('hash', ['b10c36fd2123fc0faf30e4524fd65e53'])[0]
            cached_lines = get_cached_lines(hash_code)
            if cached_lines:
                lines_list = []
                full_lines_data = {}
                for l in cached_lines:
                    lines_list.append({'id': l['id'], 'codigo': l['codigo']})
                    full_lines_data[l['codigo']] = {
                        'linha': l['nome'],
                        'horainicial': l.get('horainicial', ''),
                        'horafinal': l.get('horafinal', '')
                    }
                self.send_json_response({
                    'grupos': [{'id': '1', 'nome': 'Linhas', 'lines': lines_list}],
                    'full_lines_data': full_lines_data
                })
                return

        # 6. Proxy for ABM Tecnologia API endpoints (live vehicle positions, etc.)
        if '/api/' in self.path:
            idx = self.path.find('/api/')
            endpoint_with_query = self.path[idx + len('/api/'):]
            target_url = f"{TARGET_API}/{endpoint_with_query}"
            
            try:
                req = urllib.request.Request(
                    target_url,
                    headers={
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/json',
                        'Referer': 'https://abmtecnologia.com.br/gerador_links/view.php?hash=b10c36fd2123fc0faf30e4524fd65e53'
                    }
                )
                with urllib.request.urlopen(req, timeout=10) as response:
                    data = response.read()
                    status_code = response.getcode()
                    content_type = response.headers.get('Content-Type', 'application/json')

                    self.send_response(status_code)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as e:
                if 'get_vehicle_position' in endpoint_with_query:
                    self.send_json_response({"tracking_enabled": False, "vehicle_active": False}, 200)
                    return
                err_msg = json.dumps({"error": str(e)}).encode('utf-8')
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(err_msg)))
                self.end_headers()
                self.wfile.write(err_msg)
        else:
            self.send_response(404)
            self.end_headers()

    def handle_geocode(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        q = params.get('q', [''])[0].strip()
        google_key = params.get('google_key', [''])[0].strip()

        if not q:
            self.send_json_response([], 200)
            return

        # 1. Coordinates check: -22.8433, -47.0541
        coord_match = re.search(r'(-?\d{1,2}\.\d{3,})[,\s/]+(-?\d{1,2}\.\d{3,})', q)
        if coord_match:
            lat = float(coord_match.group(1))
            lon = float(coord_match.group(2))
            self.send_json_response([{
                'name': f"Ponto ({lat:.4f}, {lon:.4f})",
                'display': f"Coordenadas: {lat}, {lon}",
                'lat': lat,
                'lon': lon
            }])
            return

        # Check if user pasted a Google Maps short link
        if 'maps.app.goo.gl' in q or 'goo.gl/maps' in q or 'google.com/maps' in q:
            try:
                link_url = q if q.startswith('http') else 'https://' + q
                req = urllib.request.Request(link_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=6) as r:
                    final_url = r.geturl()
                    m = re.search(r'(-?\d{1,2}\.\d{3,})[,\s/]+(-?\d{1,2}\.\d{3,})', final_url)
                    if m:
                        lat = float(m.group(1))
                        lon = float(m.group(2))
                        self.send_json_response([{
                            'name': "Local do Google Maps",
                            'display': f"Link do Google Maps ({lat:.4f}, {lon:.4f})",
                            'lat': lat,
                            'lon': lon
                        }])
                        return
            except Exception as e:
                print("Error resolving Google Maps link:", e)

        # 2. Try Google Geocoding if API key provided
        if google_key:
            try:
                g_url = f"https://maps.googleapis.com/maps/api/geocode/json?address={urllib.parse.quote(q)}&region=br&key={google_key}"
                req = urllib.request.Request(g_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=6) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    if data.get('status') == 'OK':
                        results = []
                        for item in data.get('results', [])[:5]:
                            loc = item['geometry']['location']
                            results.append({
                                'name': item.get('formatted_address', '').split(',')[0],
                                'display': item.get('formatted_address', ''),
                                'lat': loc['lat'],
                                'lon': loc['lng']
                            })
                        self.send_json_response(results)
                        return
            except Exception as e:
                print("Google Geocoding error:", e)

        # 3. Try Photon Geocoder with Campinas bias
        try:
            search_query = q
            if 'campinas' not in q.lower() and 'sp' not in q.lower():
                search_query += ' Campinas'

            photon_url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(search_query)}&lat=-22.84&lon=-47.05&limit=6"
            req = urllib.request.Request(photon_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                features = data.get('features', [])
                if features:
                    results = []
                    for f in features:
                        coords = f['geometry']['coordinates']
                        props = f['properties']
                        name = props.get('name') or props.get('street') or q
                        city = props.get('city', 'Campinas')
                        state_name = props.get('state', 'SP')
                        district = props.get('district', '')
                        display_parts = [p for p in [name, district, city, state_name] if p]
                        results.append({
                            'name': name,
                            'display': ", ".join(display_parts),
                            'lat': coords[1],
                            'lon': coords[0]
                        })
                    self.send_json_response(results)
                    return
        except Exception as e:
            print("Photon error, fallback to Nominatim:", e)

        # 4. Fallback: Nominatim OpenStreetMap
        try:
            nom_query = q if 'campinas' in q.lower() else f"{q}, Campinas, SP"
            nom_url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(nom_query)}&format=json&limit=5&countrycodes=br"
            req = urllib.request.Request(nom_url, headers={'User-Agent': 'FretadoApp/1.0 (contact@fretadoapp.local)'})
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                results = []
                for item in data:
                    results.append({
                        'name': item.get('display_name', '').split(',')[0],
                        'display': item.get('display_name', ''),
                        'lat': float(item.get('lat')),
                        'lon': float(item.get('lon'))
                    })
                self.send_json_response(results)
                return
        except Exception as e:
            self.send_json_response({"error": str(e)}, 500)

    def handle_find_closest_lines(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        lat_str = params.get('lat', [''])[0]
        lon_str = params.get('lon', [''])[0]
        direction = params.get('direction', ['SAIDA'])[0].upper()
        hash_code = params.get('hash', ['b10c36fd2123fc0faf30e4524fd65e53'])[0]

        if not lat_str or not lon_str:
            self.send_json_response({"error": "Missing coordinates"}, 400)
            return

        try:
            target_lat = float(lat_str)
            target_lon = float(lon_str)
        except ValueError:
            self.send_json_response({"error": "Invalid coordinates"}, 400)
            return

        all_lines = get_cached_lines(hash_code)
        ranked = []

        for line in all_lines:
            if direction != 'ALL' and line.get('sentido') != direction:
                continue

            stops = line.get('pontos', [])
            if not stops:
                continue

            min_dist = float('inf')
            best_stop = None
            best_idx = 0

            for idx, p in enumerate(stops):
                p_lat = float(p.get('latitude', 0))
                p_lon = float(p.get('longitude', 0))
                if p_lat != 0 and p_lon != 0:
                    d = haversine_distance(target_lat, target_lon, p_lat, p_lon)
                    if d < min_dist:
                        min_dist = d
                        best_stop = p
                        best_idx = idx

            if best_stop:
                walking_min = max(1, math.ceil(min_dist / 80)) # ~80m/min
                p_lat = float(best_stop.get('latitude'))
                p_lon = float(best_stop.get('longitude'))
                
                gmaps_link = f"https://www.google.com/maps/dir/?api=1&origin={target_lat},{target_lon}&destination={p_lat},{p_lon}&travelmode=walking"

                ranked.append({
                    'line_id': line['id'],
                    'codigo': line['codigo'],
                    'nome': line['nome'],
                    'sentido': line['sentido'],
                    'horainicial': line.get('horainicial'),
                    'horafinal': line.get('horafinal'),
                    'min_distance_meters': round(min_dist, 1),
                    'min_distance_km': round(min_dist / 1000, 2),
                    'walking_minutes': walking_min,
                    'google_maps_walk_url': gmaps_link,
                    'closest_stop': {
                        'stop_index': best_idx,
                        'descricao': best_stop.get('descricao') or f"Ponto {best_idx + 1}",
                        'endereco': best_stop.get('endereco'),
                        'horario': best_stop.get('horario'),
                        'latitude': p_lat,
                        'longitude': p_lon
                    }
                })

        ranked.sort(key=lambda x: x['min_distance_meters'])
        self.send_json_response(ranked)

    def handle_traffic_eta(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        from_coords = params.get('from', [''])[0]
        to_coords = params.get('to', [''])[0]
        google_key = params.get('google_key', [''])[0]

        if not from_coords or not to_coords:
            self.send_json_response({"error": "Missing from/to coordinates"}, 400)
            return

        if google_key:
            try:
                g_url = f"https://maps.googleapis.com/maps/api/directions/json?origin={from_coords}&destination={to_coords}&departure_time=now&key={google_key}"
                req = urllib.request.Request(g_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=8) as resp:
                    g_data = json.loads(resp.read().decode('utf-8'))
                    if g_data.get('status') == 'OK' and g_data.get('routes'):
                        leg = g_data['routes'][0]['legs'][0]
                        duration_traffic = leg.get('duration_in_traffic', leg.get('duration', {})).get('value', 0)
                        distance = leg.get('distance', {}).get('value', 0)
                        self.send_json_response({
                            "provider": "Google Traffic (Live)",
                            "duration_seconds": duration_traffic,
                            "distance_meters": distance
                        })
                        return
            except Exception as e:
                print("Google Directions error, fallback to OSRM:", e)

        try:
            f_lat, f_lon = from_coords.split(',')
            t_lat, t_lon = to_coords.split(',')
            osrm_url = f"https://router.project-osrm.org/route/v1/driving/{f_lon},{f_lat};{t_lon},{t_lat}?overview=false"
            req = urllib.request.Request(osrm_url, headers={'User-Agent': 'FretadoApp/1.0'})
            with urllib.request.urlopen(req, timeout=6) as resp:
                osrm_data = json.loads(resp.read().decode('utf-8'))
                if osrm_data.get('code') == 'Ok' and osrm_data.get('routes'):
                    rt = osrm_data['routes'][0]
                    self.send_json_response({
                        "provider": "OSRM Routing Engine",
                        "duration_seconds": rt.get('duration', 0),
                        "distance_meters": rt.get('distance', 0)
                    })
                    return
        except Exception as e:
            self.send_json_response({"error": str(e)}, 500)

    def send_json_response(self, obj, code=200):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
