"""Offline HTTP smoke tests for the Jev proxy. Run with python dev/jev_server_test.py."""
import contextlib
import http.server
import io
import json
import os
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import jev_server


class ProxyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), jev_server.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def post(self, data, opener=urllib.request.urlopen):
        request = urllib.request.Request(self.url + '/api/jev', json.dumps(data).encode(), {'Content-Type': 'application/json'})
        try:
            with opener(request) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def test_missing_key_and_static_file_scope(self):
        with patch.dict(os.environ, {'TYPESAFE_API_KEY': ''}):
            status, data = self.post({'state': {}, 'questions': {}})
        self.assertEqual(status, 503)
        self.assertIn('TYPESAFE_API_KEY', data['error'])
        with self.assertRaises(urllib.error.HTTPError) as result:
            urllib.request.urlopen(self.url + '/jev_server.py')
        self.assertEqual(result.exception.code, 404)

    def test_pages_preflight_and_origin_limit(self):
        request = urllib.request.Request(self.url + '/api/jev', method='OPTIONS', headers={
            'Origin': jev_server.PAGES_ORIGIN,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
            'Access-Control-Request-Private-Network': 'true',
        })
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.headers['Access-Control-Allow-Origin'], jev_server.PAGES_ORIGIN)
            self.assertEqual(response.headers['Access-Control-Allow-Private-Network'], 'true')
        request.headers['Origin'] = 'https://untrusted.example'
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code, 403)

    def test_proxy_uses_server_key(self):
        payload = {'state': {'lyrics': '夜明け'}, 'questions': {'mood': {'type': 'choice', 'criteria': {'calm': '静か'}}}}
        captured = []

        def fake_upstream(request, timeout):
            captured.append(request)
            return contextlib.closing(io.BytesIO(json.dumps({'answers': {'mood': {'type': 'choice', 'choice': 'calm'}}}).encode()))

        with patch.dict(os.environ, {'TYPESAFE_API_KEY': 'test-secret'}), patch.object(jev_server.urllib.request, 'urlopen', side_effect=fake_upstream):
            status, data = self.post(payload)
        self.assertEqual(status, 200)
        self.assertEqual(data['answers']['mood']['choice'], 'calm')
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0].get_header('Authorization'), 'Bearer test-secret')
        self.assertEqual(json.loads(captured[0].data)['model'], 'jev-latest')


if __name__ == '__main__':
    unittest.main()
