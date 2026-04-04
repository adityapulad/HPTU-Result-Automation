"""
Vercel Serverless Function: POST /api/result
Fetches a single student result from the HPTU portal.
Body: { "url": "https://...query.aspx?id=...", "roll_no": "240505010001" }
"""

from http.server import BaseHTTPRequestHandler
import json
import re
from typing import Any, Dict, Optional
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def get_result_for_roll(query_url: str, roll_no: str) -> Optional[Dict[str, Any]]:
    """Fetch tokens and result for a single roll number."""
    session = requests.Session()

    # Step 1: GET the query page to grab ASP.NET session tokens
    resp = session.get(query_url, headers=HEADERS, timeout=10)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    tokens = {}
    for field in ["__VIEWSTATE", "__VIEWSTATEGENERATOR", "id"]:
        el = soup.find("input", {"name": field})
        if el:
            tokens[field] = el.get("value", "")

    # Step 2: POST to result.aspx
    result_url = query_url.replace("query.aspx", "result.aspx")
    form_data = {
        "__VIEWSTATE": tokens.get("__VIEWSTATE", ""),
        "__VIEWSTATEGENERATOR": tokens.get("__VIEWSTATEGENERATOR", ""),
        "RollNo": str(roll_no),
        "txtName": "",
        "id": tokens.get("id", ""),
    }
    post_headers = {**HEADERS, "Referer": query_url}
    resp = session.post(result_url, data=form_data, headers=post_headers, timeout=10)
    resp.raise_for_status()

    return parse_result(resp.text, roll_no)


def parse_result(html: str, roll_no: str) -> Optional[Dict[str, Any]]:
    """Parse the result page HTML and extract student data."""
    soup = BeautifulSoup(html, "html.parser")
    page_text = soup.get_text()

    if "Roll No Not Exist" in page_text or "not found" in page_text.lower():
        return None

    result = {"Roll No": str(roll_no)}
    all_text = soup.get_text(separator="\n")
    lines = [line.strip() for line in all_text.split("\n") if line.strip()]
    tables = soup.find_all("table")

    # Extract personal info from tables
    for table in tables:
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            cell_texts = [c.get_text(strip=True) for c in cells]
            for j, ct in enumerate(cell_texts):
                if "Roll No" in ct and j + 1 < len(cell_texts):
                    val = cell_texts[j + 1]
                    if val and val not in ["Roll No", ":", ""]:
                        result["Roll No"] = val
                elif "Student Name" in ct and j + 1 < len(cell_texts):
                    val = cell_texts[j + 1]
                    if val and val != "Student Name":
                        result["Student Name"] = val
                elif "Father" in ct and j + 1 < len(cell_texts):
                    val = cell_texts[j + 1]
                    if val and "Father" not in val:
                        result["Father's Name"] = val

    # Fallback text-based extraction
    if "Student Name" not in result:
        for i, line in enumerate(lines):
            ll = line.lower()
            if "student name" in ll:
                if ":" in line:
                    result["Student Name"] = line.split(":", 1)[1].strip()
                elif i + 1 < len(lines):
                    result["Student Name"] = lines[i + 1].strip()
            elif "father" in ll:
                if ":" in line:
                    result["Father's Name"] = line.split(":", 1)[1].strip()
                elif i + 1 < len(lines):
                    result["Father's Name"] = lines[i + 1].strip()

    # Extract subjects
    subjects = []
    for table in tables:
        header_row = table.find("tr")
        if not header_row:
            continue
        headers = [th.get_text(strip=True).lower() for th in header_row.find_all(["th", "td"])]
        has_subject = any("subject" in h for h in headers)
        has_grade = any("grade" in h for h in headers)

        if has_subject or has_grade:
            for row in table.find_all("tr")[1:]:
                cells = row.find_all("td")
                if len(cells) >= 3:
                    cell_texts = [c.get_text(strip=True) for c in cells]
                    sub = {}
                    for idx, hdr in enumerate(headers):
                        if idx < len(cell_texts):
                            if "subject" in hdr and "code" not in hdr:
                                sub["Subject"] = cell_texts[idx]
                            elif "code" in hdr:
                                sub["Code"] = cell_texts[idx]
                            elif "credit" in hdr:
                                sub["Credit"] = cell_texts[idx]
                            elif "grade" in hdr:
                                sub["Grade"] = cell_texts[idx]
                    if sub.get("Subject") or sub.get("Code"):
                        subjects.append(sub)

    result["Subjects"] = subjects

    # Extract SGPA / CGPA from tables
    for table in tables:
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            cell_texts = [c.get_text(strip=True) for c in cells]
            for j, ct in enumerate(cell_texts):
                if "SGPA" in ct:
                    if j + 1 < len(cell_texts) and cell_texts[j + 1] not in ["", "SGPA"]:
                        result["SGPA"] = cell_texts[j + 1]
                    elif ":" in ct:
                        result["SGPA"] = ct.split(":", 1)[1].strip()
                elif "CGPA" in ct:
                    if j + 1 < len(cell_texts) and cell_texts[j + 1] not in ["", "CGPA"]:
                        result["CGPA"] = cell_texts[j + 1]
                    elif ":" in ct:
                        result["CGPA"] = ct.split(":", 1)[1].strip()

    # Fallback SGPA/CGPA from text
    for line in lines:
        ll = line.lower()
        if "sgpa" in ll and "SGPA" not in result:
            nums = re.findall(r"\d+\.?\d*", line)
            if nums:
                result["SGPA"] = nums[-1]
        elif "cgpa" in ll and "CGPA" not in result:
            nums = re.findall(r"\d+\.?\d*", line)
            if nums:
                result["CGPA"] = nums[-1]

    # Extract result status from tables
    for table in tables:
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            cell_texts = [c.get_text(strip=True) for c in cells]
            for j, ct in enumerate(cell_texts):
                if ct.strip().lower() == "result" and j + 1 < len(cell_texts):
                    result["Result"] = cell_texts[j + 1].strip()

    # Fallback result status from text
    if "Result" not in result:
        for line in lines:
            ll = line.lower().strip()
            if ll in ["pass", "fail", "re-appear", "reappear", "absent", "comp"]:
                result["Result"] = line.strip().upper()
                break
            elif "result" in ll and ":" in line:
                val = line.split(":", 1)[1].strip()
                if val.upper() in ["PASS", "FAIL", "RE-APPEAR", "REAPPEAR", "ABSENT", "COMP"]:
                    result["Result"] = val.upper()
                    break

    return result


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))

            url = body.get("url", "")
            roll_no = body.get("roll_no", "")

            if not url or not roll_no:
                raise ValueError("Missing url or roll_no")

            result = get_result_for_roll(url, roll_no)
            resp_body = json.dumps({"success": True, "result": result}).encode()
            self.send_response(200)
        except Exception as e:
            resp_body = json.dumps({"success": False, "error": str(e)}).encode()
            self.send_response(500)

        self._send_cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp_body)))
        self.end_headers()
        self.wfile.write(resp_body)

    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, fmt, *args):
        pass  # suppress default logging
