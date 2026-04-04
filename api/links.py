"""
Vercel Serverless Function: GET /api/links
Fetches all B.Tech result links from the HPTU portal.
"""

from http.server import BaseHTTPRequestHandler
import json
import requests
from bs4 import BeautifulSoup

LISTING_URL = "https://himachal-pradesh.indiaresults.com/himtu/default.aspx"
BTECH_KEYWORDS = ["b.tech", "btech", "b tech"]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def is_btech(title: str) -> bool:
    t = title.lower()
    return any(k in t for k in BTECH_KEYWORDS)


def fetch_btech_links():
    resp = requests.get(LISTING_URL, headers=HEADERS, timeout=12)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    results = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        title = a.get_text(strip=True)
        if not title or href in seen:
            continue
        if "query.aspx" not in href:
            continue
        if not is_btech(title):
            continue
        seen.add(href)
        results.append({"title": title, "url": href})

    results.sort(key=lambda x: x["title"])
    return results


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        try:
            links = fetch_btech_links()
            body = json.dumps({"success": True, "links": links}).encode()
            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            body = json.dumps({"success": False, "error": str(e)}).encode()
            self.send_response(500)
            self._send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, fmt, *args):
        pass  # suppress default logging
