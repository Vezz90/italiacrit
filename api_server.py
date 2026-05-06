import http.server
import socketserver
import os
import json
import subprocess
import sys
from urllib.parse import urlparse, parse_qs

PORT = 8000
DATA_DIR = "data"

class AdminHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        parsed_path = urlparse(self.path)
        
        if parsed_path.path == "/api/save_override":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                self.save_override(data)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success"}).encode())
            except Exception as e:
                self.send_error(400, str(e))
                
        elif parsed_path.path == "/api/trigger_scraper":
            try:
                # Esegui lo scraper in background
                subprocess.Popen([sys.executable, "scraper/fci_complete_scraper.py"])
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "started"}).encode())
            except Exception as e:
                self.send_error(500, str(e))
        else:
            self.send_error(404)

    def save_override(self, data):
        # data: { "id": "RACE_SLUG_DATE", "mult": 3, "tipo": "internazionale", ... }
        path = os.path.join(DATA_DIR, "user_overrides.json")
        overrides = {}
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                overrides = json.load(f)
        
        race_id = data.get("id")
        if race_id:
            # Determina i flag in base al tipo o ricevi i flag espliciti
            tipo = data.get("tipo", "regionale")
            is_cr = data.get("is_cr", False) or (tipo == "campionato_regionale")
            is_ci = data.get("is_ci", False) or (tipo == "campionato_italiano")
            
            overrides[race_id] = {
                "mult": data.get("mult", 1),
                "tipo": tipo,
                "is_cr": is_cr,
                "is_ci": is_ci,
                "reg": data.get("reg", "")
            }
            with open(path, "w", encoding="utf-8") as f:
                json.dump(overrides, f, indent=2, ensure_ascii=False)

    # Permetti CORS se necessario (anche se siamo sullo stesso dominio)
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

if __name__ == "__main__":
    # Assicurati che data/ esista
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
        
    print(f"--- ITALICRIT API SERVER avviato su http://localhost:{PORT} ---")
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), AdminHandler) as httpd:
        httpd.serve_forever()
