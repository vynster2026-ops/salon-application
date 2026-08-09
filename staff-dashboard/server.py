import http.server
import socketserver
import urllib.parse
import json

PORT = 8081
checkout_status = {}

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Bypass-Tunnel-Reminder, Content-Type')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.end_headers()

    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        
        if parsed_path.path == '/api/confirm':
            query = urllib.parse.parse_qs(parsed_path.query)
            apt_id = query.get('aptId', [None])[0]
            if apt_id:
                checkout_status[apt_id] = True
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True}).encode())
            else:
                self.send_response(400)
                self.end_headers()
            return
            
        elif parsed_path.path == '/api/status':
            query = urllib.parse.parse_qs(parsed_path.query)
            apt_id = query.get('aptId', [None])[0]
            confirmed = checkout_status.get(apt_id, False)
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'confirmed': confirmed}).encode())
            return
            
        elif parsed_path.path == '/api/reset':
            query = urllib.parse.parse_qs(parsed_path.query)
            apt_id = query.get('aptId', [None])[0]
            if apt_id:
                checkout_status[apt_id] = False
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
            return

        return super().do_GET()

with socketserver.TCPServer(("0.0.0.0", PORT), CustomHandler) as httpd:
    print("Serving at port", PORT)
    httpd.serve_forever()
