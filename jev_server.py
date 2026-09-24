"""Serve JIZURA locally and keep the TypeSafe API key out of browser code.

Run: TYPESAFE_API_KEY=... python jev_server.py  (PowerShell: $env:TYPESAFE_API_KEY='...')
"""
import http.server
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
API_URL = 'https://api.typesafe.ai/v1/systemone'
PAGES_ORIGIN = 'https://hirazisora.github.io'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path not in ('/', '/index.html', '/en/', '/en/index.html', '/favicon.ico'):
            self.send_error(404)
            return
        super().do_GET()

    def allowed_origin(self):
        origin = self.headers.get('Origin')
        local = {f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}'}
        return origin if origin in local or origin == PAGES_ORIGIN else None

    def do_OPTIONS(self):
        if self.path != '/api/jev' or not self.allowed_origin():
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.allowed_origin())
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Vary', 'Origin')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_POST(self):
        if self.path != '/api/jev':
            self.send_error(404)
            return
        if self.headers.get('Origin') and not self.allowed_origin():
            self.send_error(403)
            return
        key = os.environ.get('TYPESAFE_API_KEY', '')
        if not key:
            self.reply(503, {'error': 'TYPESAFE_API_KEY が設定されていません'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 1 or length > 65536:
                self.reply(413, {'error': 'リクエストが大きすぎます'})
                return
            incoming = json.loads(self.rfile.read(length))
            if not isinstance(incoming, dict) or not isinstance(incoming.get('state'), dict) or not isinstance(incoming.get('questions'), dict):
                raise ValueError('invalid request')
            questions = incoming['questions']
            if len(questions) < 1 or len(questions) > 40 or any(not isinstance(q, dict) or q.get('type') != 'choice' for q in questions.values()):
                raise ValueError('invalid questions')
            payload = json.dumps({'model': 'jev-latest', 'state': incoming['state'], 'questions': questions}, ensure_ascii=False).encode('utf-8')
            if len(payload) > 65536:
                self.reply(413, {'error': 'リクエストが大きすぎます'})
                return
            request = urllib.request.Request(API_URL, payload, {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(request, timeout=20) as response:
                result = json.load(response)
            self.reply(200, {'answers': result.get('answers', {})})
        except ValueError:
            self.reply(400, {'error': 'Jev リクエストの形式が不正です'})
        except urllib.error.HTTPError as error:
            self.reply(502, {'error': f'Jev API が HTTP {error.code} を返しました。APIキーと利用権限を確認してください'})
        except (urllib.error.URLError, TimeoutError) as error:
            self.reply(502, {'error': f'Jev API に接続できません: {error.reason if hasattr(error, "reason") else error}'})

    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        if self.allowed_origin():
            self.send_header('Access-Control-Allow-Origin', self.allowed_origin())
            self.send_header('Vary', 'Origin')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    port = int(os.environ.get('JIZURA_PORT', '8765'))
    print(f'JIZURA: http://127.0.0.1:{port}/')
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
