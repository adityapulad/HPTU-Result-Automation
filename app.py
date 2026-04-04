"""
Result compiler - Flask Backend
Scrapes B.Tech results from indiaresults.com portal and exports to Excel.
"""

from flask import Flask, request, jsonify, send_file, Response, send_from_directory
from flask_cors import CORS
import os
import requests
from bs4 import BeautifulSoup
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
import time
import re
import json
import io
import threading
import uuid
from datetime import datetime

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

FRONTEND_DIR = os.path.dirname(os.path.abspath(__file__))

BASE_URL = "https://himturesult.indiaresults.com/hp/himtu/hp-himtu"
LISTING_URL = "https://himachal-pradesh.indiaresults.com/himtu/default.aspx"

# In-memory job store: job_id -> { status, progress, total, results, error, filename }
jobs = {}
jobs_lock = threading.Lock()

BTECH_KEYWORDS = [
    "b.tech", "btech", "b tech",
]

def is_btech(title: str) -> bool:
    t = title.lower()
    return any(k in t for k in BTECH_KEYWORDS)


def fetch_btech_links():
    """Scrape the HPTU listing page and return only B.Tech links."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    resp = requests.get(LISTING_URL, headers=headers, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    results = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        title = a.get_text(strip=True)
        if not title or href in seen:
            continue
        # Only include links that point to query.aspx (result pages)
        if "query.aspx" not in href:
            continue
        if not is_btech(title):
            continue
        seen.add(href)

        # Extract date from nearby text (parent row)
        results.append({
            "title": title,
            "url": href,
        })

    # Sort alphabetically for display
    results.sort(key=lambda x: x["title"])
    return results


def get_session_tokens(session, query_url):
    """Fetch the query page to get ASP.NET session tokens."""
    resp = session.get(query_url, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    tokens = {}
    viewstate = soup.find("input", {"name": "__VIEWSTATE"})
    viewstate_gen = soup.find("input", {"name": "__VIEWSTATEGENERATOR"})
    hidden_id = soup.find("input", {"name": "id"})

    if viewstate:
        tokens["__VIEWSTATE"] = viewstate.get("value", "")
    if viewstate_gen:
        tokens["__VIEWSTATEGENERATOR"] = viewstate_gen.get("value", "")
    if hidden_id:
        tokens["id"] = hidden_id.get("value", "")
    
    return tokens


def fetch_result(session, roll_no, tokens, query_url):
    """Fetch the result for a given roll number."""
    result_url = query_url.replace("query.aspx", "result.aspx")
    form_data = {
        "__VIEWSTATE": tokens.get("__VIEWSTATE", ""),
        "__VIEWSTATEGENERATOR": tokens.get("__VIEWSTATEGENERATOR", ""),
        "RollNo": str(roll_no),
        "txtName": "",
        "id": tokens.get("id", ""),
    }
    headers = {
        "Referer": query_url,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    resp = session.post(result_url, data=form_data, headers=headers, timeout=15)
    resp.raise_for_status()
    return resp.text


def parse_result(html, roll_no):
    """Parse the result HTML and extract student data."""
    soup = BeautifulSoup(html, "html.parser")
    page_text = soup.get_text()

    if "Roll No Not Exist" in page_text or "not found" in page_text.lower():
        return None

    result = {"Roll No": str(roll_no)}

    all_text = soup.get_text(separator="\n")
    lines = [line.strip() for line in all_text.split("\n") if line.strip()]

    tables = soup.find_all("table")

    # Extract personal details from tables
    for table in tables:
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            cell_texts = [c.get_text(strip=True) for c in cells]
            for j, ct in enumerate(cell_texts):
                if "Roll No" in ct and j + 1 < len(cell_texts):
                    val = cell_texts[j + 1]
                    if val and val != "Roll No" and val not in [":", ""]:
                        result["Roll No"] = val
                elif "Student Name" in ct and j + 1 < len(cell_texts):
                    val = cell_texts[j + 1]
                    if val and val != "Student Name":
                        result["Student Name"] = val
                elif "Father" in ct and j + 1 < len(cell_texts):
                    val = cell_texts[j + 1]
                    if val and "Father" not in val:
                        result["Father's Name"] = val

    # Fallback text extraction for name/father
    if "Student Name" not in result:
        for i, line in enumerate(lines):
            if "student name" in line.lower():
                if ":" in line:
                    result["Student Name"] = line.split(":", 1)[1].strip()
                elif i + 1 < len(lines):
                    result["Student Name"] = lines[i + 1].strip()
            elif "father" in line.lower():
                if ":" in line:
                    result["Father's Name"] = line.split(":", 1)[1].strip()
                elif i + 1 < len(lines):
                    result["Father's Name"] = lines[i + 1].strip()

    # Extract subjects/marks table
    subjects = []
    for table in tables:
        header_row = table.find("tr")
        if not header_row:
            continue
        headers = [th.get_text(strip=True).lower() for th in header_row.find_all(["th", "td"])]
        has_subject = any("subject" in h for h in headers)
        has_grade = any("grade" in h for h in headers)

        if has_subject or has_grade:
            rows = table.find_all("tr")[1:]
            for row in rows:
                cells = row.find_all("td")
                if len(cells) >= 3:
                    cell_texts = [c.get_text(strip=True) for c in cells]
                    subject_data = {}
                    for idx, header in enumerate(headers):
                        if idx < len(cell_texts):
                            if "subject" in header and "code" not in header:
                                subject_data["Subject"] = cell_texts[idx]
                            elif "code" in header:
                                subject_data["Code"] = cell_texts[idx]
                            elif "credit" in header:
                                subject_data["Credit"] = cell_texts[idx]
                            elif "grade" in header:
                                subject_data["Grade"] = cell_texts[idx]
                    if subject_data.get("Subject") or subject_data.get("Code"):
                        subjects.append(subject_data)

    result["Subjects"] = subjects

    # Extract SGPA, CGPA from tables
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

    # Fallback text SGPA/CGPA extraction
    if "SGPA" not in result or "CGPA" not in result:
        for line in lines:
            lower = line.lower()
            if "sgpa" in lower and "SGPA" not in result:
                nums = re.findall(r"\d+\.?\d*", line)
                if nums:
                    result["SGPA"] = nums[-1]
            elif "cgpa" in lower and "CGPA" not in result:
                nums = re.findall(r"\d+\.?\d*", line)
                if nums:
                    result["CGPA"] = nums[-1]

    # Find result status (PASS/FAIL/RE-APPEAR)
    for table in tables:
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            cell_texts = [c.get_text(strip=True) for c in cells]
            for j, ct in enumerate(cell_texts):
                if ct.strip().lower() == "result" and j + 1 < len(cell_texts):
                    result["Result"] = cell_texts[j + 1].strip()

    if "Result" not in result:
        for line in lines:
            lower = line.lower().strip()
            if lower in ["pass", "fail", "re-appear", "reappear", "absent", "comp"]:
                result["Result"] = line.strip().upper()
                break
            elif "result" in lower and ":" in line:
                val = line.split(":", 1)[1].strip()
                if val.upper() in ["PASS", "FAIL", "RE-APPEAR", "REAPPEAR", "ABSENT", "COMP"]:
                    result["Result"] = val.upper()
                    break

    return result


def create_excel(all_results, exam_title):
    """Create a styled Excel workbook from the results and return as bytes."""
    wb = openpyxl.Workbook()
    ws = wb.active
    # Sanitize sheet name (max 31 chars, no special chars)
    sheet_name = re.sub(r'[\\/*?:\[\]]', '', exam_title)[:31]
    ws.title = sheet_name or "Results"

    # Collect all unique subjects
    all_subjects = []
    seen_subjects = set()
    for r in all_results:
        for s in r.get("Subjects", []):
            key = s.get("Code", s.get("Subject", ""))
            if key and key not in seen_subjects:
                seen_subjects.add(key)
                all_subjects.append(s)

    # Styles
    header_font = Font(name="Calibri", bold=True, size=11, color="FFFFFF")
    header_fill = PatternFill(start_color="2F5496", end_color="2F5496", fill_type="solid")
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell_align = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )
    pass_fill = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
    fail_fill = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
    grade_r_fill = PatternFill(start_color="FF9999", end_color="FF9999", fill_type="solid")
    alt_fill = PatternFill(start_color="EEF2FF", end_color="EEF2FF", fill_type="solid")

    total_cols = 4 + len(all_subjects) + 3

    # Title row
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=total_cols)
    title_cell = ws.cell(row=1, column=1)
    title_cell.value = f"HIMACHAL PRADESH TECHNICAL UNIVERSITY\n{exam_title.upper()}"
    title_cell.font = Font(name="Calibri", bold=True, size=13, color="1F3864")
    title_cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    title_fill = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
    title_cell.fill = title_fill
    ws.row_dimensions[1].height = 50

    # Generated on row
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=total_cols)
    gen_cell = ws.cell(row=2, column=1)
    gen_cell.value = f"Generated on: {datetime.now().strftime('%d-%b-%Y %H:%M')}  |  Total Students: {len(all_results)}"
    gen_cell.font = Font(name="Calibri", italic=True, size=9, color="595959")
    gen_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[2].height = 18

    # Build headers
    col_headers = ["S.No", "Roll No", "Student Name", "Father's Name"]
    for sub in all_subjects:
        code = sub.get("Code", sub.get("Subject", "Unknown"))
        col_headers.append(code)
    col_headers.extend(["SGPA", "CGPA", "Result"])

    # Write header row
    row_num = 3
    for col, header in enumerate(col_headers, 1):
        cell = ws.cell(row=row_num, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_align
        cell.border = thin_border
    ws.row_dimensions[row_num].height = 35

    # Subject sub-headers
    sub_header_row = 4
    for col in range(1, 5):
        cell = ws.cell(row=sub_header_row, column=col, value="")
        cell.border = thin_border
        cell.fill = PatternFill(start_color="BDD7EE", end_color="BDD7EE", fill_type="solid")
    for idx, sub in enumerate(all_subjects):
        col = 5 + idx
        name = sub.get("Subject", "")
        credit = sub.get("Credit", "")
        cell = ws.cell(row=sub_header_row, column=col,
                       value=f"{name}\n(Cr: {credit})" if name else "")
        cell.font = Font(name="Calibri", size=8, italic=True, color="1F3864")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border
        cell.fill = PatternFill(start_color="BDD7EE", end_color="BDD7EE", fill_type="solid")
    for col in range(5 + len(all_subjects), total_cols + 1):
        cell = ws.cell(row=sub_header_row, column=col, value="")
        cell.border = thin_border
        cell.fill = PatternFill(start_color="BDD7EE", end_color="BDD7EE", fill_type="solid")
    ws.row_dimensions[sub_header_row].height = 45

    # Write data rows
    data_start = 5
    for i, result in enumerate(all_results):
        row = data_start + i
        use_alt = (i % 2 == 1)

        def dc(col, val, align=None, bold=False):
            cell = ws.cell(row=row, column=col, value=val)
            cell.alignment = align or cell_align
            cell.border = thin_border
            if use_alt:
                cell.fill = alt_fill
            if bold:
                cell.font = Font(bold=True)
            return cell

        dc(1, i + 1)
        dc(2, result.get("Roll No", ""))
        dc(3, result.get("Student Name", ""), Alignment(horizontal="left", vertical="center"))
        dc(4, result.get("Father's Name", ""), Alignment(horizontal="left", vertical="center"))

        student_subjects = {s.get("Code", s.get("Subject", "")): s for s in result.get("Subjects", [])}
        for idx, sub in enumerate(all_subjects):
            key = sub.get("Code", sub.get("Subject", ""))
            grade = student_subjects.get(key, {}).get("Grade", "-")
            cell = dc(5 + idx, grade)
            if grade.strip().upper() == "R":
                cell.fill = grade_r_fill

        sgpa_col = 5 + len(all_subjects)
        cgpa_col = sgpa_col + 1
        result_col = cgpa_col + 1

        sgpa_val = result.get("SGPA", "")
        cgpa_val = result.get("CGPA", "")
        try:
            sgpa_val = float(sgpa_val)
        except (ValueError, TypeError):
            pass
        try:
            cgpa_val = float(cgpa_val)
        except (ValueError, TypeError):
            pass

        dc(sgpa_col, sgpa_val)
        dc(cgpa_col, cgpa_val)

        result_status = result.get("Result", "")
        result_cell = dc(result_col, result_status, bold=True)
        if result_status.upper() == "PASS":
            result_cell.fill = pass_fill
        elif result_status.upper() in ["FAIL", "RE-APPEAR", "REAPPEAR"]:
            result_cell.fill = fail_fill

    # Column widths
    ws.column_dimensions["A"].width = 6
    ws.column_dimensions["B"].width = 18
    ws.column_dimensions["C"].width = 26
    ws.column_dimensions["D"].width = 26
    for idx in range(len(all_subjects)):
        col_letter = openpyxl.utils.get_column_letter(5 + idx)
        ws.column_dimensions[col_letter].width = 13
    ws.column_dimensions[openpyxl.utils.get_column_letter(5 + len(all_subjects))].width = 10
    ws.column_dimensions[openpyxl.utils.get_column_letter(6 + len(all_subjects))].width = 10
    ws.column_dimensions[openpyxl.utils.get_column_letter(7 + len(all_subjects))].width = 14

    ws.freeze_panes = f"E{data_start}"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def scrape_job(job_id, query_url, start_roll, end_roll, skip_rolls_set, exam_title):
    """Background thread to scrape results."""
    with jobs_lock:
        jobs[job_id]["status"] = "running"

    session = requests.Session()
    try:
        tokens = get_session_tokens(session, query_url)
    except Exception as e:
        with jobs_lock:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = f"Failed to get session tokens: {e}"
        return

    rolls = [r for r in range(start_roll, end_roll + 1) if r not in skip_rolls_set]
    total = len(rolls)

    with jobs_lock:
        jobs[job_id]["total"] = total
        jobs[job_id]["progress"] = 0

    all_results = []
    not_found = []
    failed = []

    for i, roll_no in enumerate(rolls):
        roll_str = str(roll_no)
        try:
            html = fetch_result(session, roll_str, tokens, query_url)
            result = parse_result(html, roll_str)
            if result:
                all_results.append(result)
                with jobs_lock:
                    jobs[job_id]["log"].append({
                        "roll": roll_str,
                        "name": result.get("Student Name", "N/A"),
                        "sgpa": result.get("SGPA", "N/A"),
                        "result": result.get("Result", "N/A"),
                        "status": "found"
                    })
            else:
                not_found.append(roll_str)
                with jobs_lock:
                    jobs[job_id]["log"].append({
                        "roll": roll_str,
                        "status": "not_found"
                    })
        except Exception as e:
            failed.append(roll_str)
            with jobs_lock:
                jobs[job_id]["log"].append({
                    "roll": roll_str,
                    "status": "error",
                    "error": str(e)
                })

        with jobs_lock:
            jobs[job_id]["progress"] = i + 1

        # Refresh tokens every 15 requests
        if (i + 1) % 15 == 0:
            try:
                tokens = get_session_tokens(session, query_url)
            except Exception:
                pass

        time.sleep(0.4)

    # Generate Excel
    if all_results:
        excel_buf = create_excel(all_results, exam_title)
        with jobs_lock:
            jobs[job_id]["excel"] = excel_buf.getvalue()
            jobs[job_id]["filename"] = re.sub(r'[^a-zA-Z0-9_\- ]', '', exam_title)[:50].strip() + ".xlsx"

    with jobs_lock:
        jobs[job_id]["status"] = "done"
        jobs[job_id]["found"] = len(all_results)
        jobs[job_id]["not_found"] = not_found
        jobs[job_id]["failed"] = failed


# ─── ROUTES ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)


@app.route("/api/links", methods=["GET"])
def get_links():
    try:
        links = fetch_btech_links()
        return jsonify({"success": True, "links": links})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/result", methods=["POST"])
def get_result():
    try:
        data = request.get_json(silent=True) or {}
        query_url = data.get("url", "")
        roll_no = data.get("roll_no", "")

        if not query_url or not roll_no:
            return jsonify({"success": False, "error": "Missing url or roll_no"}), 400

        session = requests.Session()
        tokens = get_session_tokens(session, query_url)
        html = fetch_result(session, roll_no, tokens, query_url)
        result = parse_result(html, roll_no)

        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/start", methods=["POST"])
def start_job():
    data = request.json
    query_url = data.get("url", "")
    start_roll = int(data.get("start_roll", 0))
    end_roll = int(data.get("end_roll", 0))
    skip_rolls = data.get("skip_rolls", [])
    exam_title = data.get("title", "HPTU Result")

    if not query_url or start_roll <= 0 or end_roll < start_roll:
        return jsonify({"success": False, "error": "Invalid parameters"}), 400

    if end_roll - start_roll > 500:
        return jsonify({"success": False, "error": "Roll number range too large (max 500)"}), 400

    job_id = str(uuid.uuid4())
    skip_set = set(int(r) for r in skip_rolls if r)

    with jobs_lock:
        jobs[job_id] = {
            "status": "starting",
            "progress": 0,
            "total": end_roll - start_roll + 1,
            "log": [],
            "excel": None,
            "filename": None,
            "found": 0,
            "not_found": [],
            "failed": [],
            "error": None,
        }

    t = threading.Thread(
        target=scrape_job,
        args=(job_id, query_url, start_roll, end_roll, skip_set, exam_title),
        daemon=True
    )
    t.start()

    return jsonify({"success": True, "job_id": job_id})


@app.route("/api/status/<job_id>", methods=["GET"])
def job_status(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({"success": False, "error": "Job not found"}), 404

    # Don't send excel bytes over status API
    return jsonify({
        "success": True,
        "status": job["status"],
        "progress": job["progress"],
        "total": job["total"],
        "log": job["log"][-50:],  # last 50 entries
        "found": job["found"],
        "not_found": job["not_found"],
        "failed": job["failed"],
        "error": job["error"],
        "has_excel": job["excel"] is not None,
        "filename": job["filename"],
    })


@app.route("/api/download/<job_id>", methods=["GET"])
def download_excel(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if not job["excel"]:
        return jsonify({"error": "No Excel file available"}), 404

    filename = job["filename"] or "HPTU_Results.xlsx"
    return Response(
        job["excel"],
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


if __name__ == "__main__":
    app.run(debug=True, port=5000, threaded=True)
