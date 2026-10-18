// ─── Config ──────────────────────────────────────────────────────────────────
// All API calls use relative paths — works on Vercel AND local Flask server
const API = {
  links: '/api/links',
  result: '/api/result',
};

// ─── State ───────────────────────────────────────────────────────────────────
let allLinks = [];
let selectedLink = null;
let isScraping = false;
let cancelRequested = false;
let scrapedResults = [];

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadLinks();
  setupRollInputs();
});

// ─── Load Links ───────────────────────────────────────────────────────────────
async function loadLinks() {
  show('linksLoading');
  hide('linksError');
  hide('linksList');
  hide('selectedExam');

  try {
    const res = await fetch(API.links);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');

    allLinks = data.links;
    renderLinks(allLinks);
    show('linksList');
    showToast(`Loaded ${allLinks.length} B.Tech result links`, 'success');
  } catch (err) {
    show('linksError');
    document.getElementById('linksErrorMsg').textContent = 'Error: ' + err.message;
    showToast('Failed to load links. If running locally, ensure the server is up.', 'error');
  } finally {
    hide('linksLoading');
  }
}

function filterLinks() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  renderLinks(allLinks.filter(l => l.title.toLowerCase().includes(q)));
}

function renderLinks(links) {
  const container = document.getElementById('linksList');
  if (links.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-faint);font-size:0.88rem;">No results match your search</div>`;
    return;
  }
  container.innerHTML = links.map((link) => {
    const isSelected = selectedLink && selectedLink.url === link.url;
    const origIdx = allLinks.indexOf(link);
    const sem = extractSemester(link.title);
    const branch = extractBranch(link.title);
    return `
      <div class="link-item ${isSelected ? 'selected' : ''}" onclick="selectLink(${origIdx})">
        <div class="link-item-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${isSelected ? '#818cf8' : '#6366f1'}" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <div class="link-item-text">
          <div class="link-item-title" title="${link.title}">${link.title}</div>
          <div class="link-item-sub">${branch ? branch + ' · ' : ''}${sem}</div>
        </div>
        <div class="link-item-arrow">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>`;
  }).join('');
}

function extractSemester(title) {
  const m = title.match(/(\d+(?:st|nd|rd|th)?\s*sem(?:ester)?)/i);
  return m ? m[0] : '';
}

function extractBranch(title) {
  const branches = ['CSE', 'CS&E', 'AI-DS', 'AI&DS', 'AI&ML', 'AI/ML', 'Mechanical', 'Civil', 'ECE', 'EE', 'IT'];
  for (const b of branches) {
    if (title.toUpperCase().includes(b.toUpperCase())) return b;
  }
  return '';
}

function selectLink(idx) {
  selectedLink = allLinks[idx];
  document.getElementById('selectedTitle').textContent = selectedLink.title;
  show('selectedExam');
  hide('linksList');
  const step2 = document.getElementById('step2');
  step2.style.opacity = '1';
  step2.style.pointerEvents = 'all';
  showToast('Exam selected ✓', 'success');
}

function clearSelection() {
  selectedLink = null;
  hide('selectedExam');
  show('linksList');
  renderLinks(allLinks);
  document.getElementById('step2').style.opacity = '0.5';
  document.getElementById('step2').style.pointerEvents = 'none';
}

// ─── Custom (unlisted) result link ────────────────────────────────────────────
function useCustomLink() {
  const raw = document.getElementById('customUrlInput').value.trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    showToast('Please paste a valid result link', 'error');
    return;
  }
  // Mobile links (mquery.aspx) use the same backend as query.aspx
  url.pathname = url.pathname.replace(/mquery\.aspx$/i, 'query.aspx');
  const id = url.searchParams.get('id');
  if (!/query\.aspx$/i.test(url.pathname) || !id) {
    showToast('Link must look like …/query.aspx?id=XXXXXXXXXX', 'error');
    return;
  }

  const normalized = url.toString();
  const listed = allLinks.find(l => l.url.includes(`id=${id}`));
  selectedLink = listed
    ? listed
    : { title: `HPTU Result (id ${id})`, url: normalized, custom: true };

  document.getElementById('selectedTitle').textContent = selectedLink.title;
  show('selectedExam');
  hide('linksList');
  const step2 = document.getElementById('step2');
  step2.style.opacity = '1';
  step2.style.pointerEvents = 'all';
  showToast('Custom link selected ✓', 'success');
}

// ─── Roll Number Inputs ────────────────────────────────────────────────────────
function setupRollInputs() {
  ['startRoll', 'endRoll', 'skipRolls'].forEach(id => {
    document.getElementById(id).addEventListener('input', updatePreview);
  });
}

function updatePreview() {
  const start = parseInt(document.getElementById('startRoll').value.trim());
  const end = parseInt(document.getElementById('endRoll').value.trim());
  const skipText = document.getElementById('skipRolls').value.trim();
  const preview = document.getElementById('rollPreview');

  if (!isNaN(start) && !isNaN(end) && end >= start) {
    const total = end - start + 1;
    const skipCount = skipText
      ? skipText.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= start && n <= end).length
      : 0;
    const toFetch = total - skipCount;
    const estSecs = toFetch * 2.5; // ~2.5s per roll (2 HTTP requests each)

    document.getElementById('previewTotal').textContent = total;
    document.getElementById('previewSkip').textContent = skipCount;
    document.getElementById('previewFetch').textContent = toFetch;
    document.getElementById('previewTime').textContent = formatTime(estSecs);
    preview.style.display = 'flex';
  } else {
    preview.style.display = 'none';
  }
}

function formatTime(seconds) {
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  const m = Math.ceil(seconds / 60);
  return `~${m} min`;
}

// ─── Start Scraping ────────────────────────────────────────────────────────────
async function startScraping() {
  if (!selectedLink) { showToast('Please select an exam first', 'error'); return; }

  const startRoll = parseInt(document.getElementById('startRoll').value.trim());
  const endRoll = parseInt(document.getElementById('endRoll').value.trim());
  const skipText = document.getElementById('skipRolls').value.trim();

  if (isNaN(startRoll) || isNaN(endRoll)) { showToast('Invalid roll numbers', 'error'); return; }
  if (endRoll < startRoll) { showToast('End roll must be ≥ Start roll', 'error'); return; }
  if (endRoll - startRoll > 500) { showToast('Range too large (max 500)', 'error'); return; }

  const skipSet = new Set(
    skipText ? skipText.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : []
  );

  const rolls = [];
  for (let r = startRoll; r <= endRoll; r++) {
    if (!skipSet.has(r)) rolls.push(r);
  }

  // Reset state
  scrapedResults = [];
  cancelRequested = false;
  isScraping = true;

  // Show step 3
  hide('step1'); hide('step2'); show('step3');
  document.getElementById('progressDesc').textContent = selectedLink.title;
  document.getElementById('logContainer').innerHTML = '';
  document.getElementById('logCount').textContent = '0';
  resetStats();

  let notFoundCount = 0;
  let failedCount = 0;
  let logTotal = 0;

  for (let i = 0; i < rolls.length; i++) {
    if (cancelRequested) break;

    const roll = String(rolls[i]);
    const pct = Math.round(((i) / rolls.length) * 100);

    // Update progress bar
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressCount').textContent = `${i} / ${rolls.length}`;
    document.getElementById('progressPct').textContent = pct + '%';
    document.getElementById('statRemaining').textContent = rolls.length - i;

    try {
      const res = await fetch(API.result, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: selectedLink.url, roll_no: roll }),
      });

      const data = await res.json();

      if (data.success && data.result) {
        scrapedResults.push(data.result);
        // Pasted links have no title yet: take it from the result page
        if (selectedLink.custom && data.result['Exam']) {
          selectedLink.title = data.result['Exam'];
          selectedLink.custom = false;
          document.getElementById('selectedTitle').textContent = selectedLink.title;
          document.getElementById('progressDesc').textContent = selectedLink.title;
        }
        document.getElementById('statFound').textContent = scrapedResults.length;
        addLogEntry(roll, data.result, 'found');
      } else {
        notFoundCount++;
        document.getElementById('statNotFound').textContent = notFoundCount;
        addLogEntry(roll, null, 'not_found');
      }
    } catch (e) {
      failedCount++;
      document.getElementById('statFailed').textContent = failedCount;
      addLogEntry(roll, null, 'error', e.message);
    }

    logTotal++;
    document.getElementById('logCount').textContent = logTotal;

    // Small delay to be respectful to the portal
    await sleep(300);
  }

  // Final progress update
  document.getElementById('progressBar').style.width = '100%';
  document.getElementById('progressCount').textContent = `${rolls.length} / ${rolls.length}`;
  document.getElementById('progressPct').textContent = '100%';
  document.getElementById('statRemaining').textContent = '0';

  isScraping = false;
  setTimeout(() => showStep4(rolls.length, notFoundCount, failedCount), 400);
}

function resetStats() {
  ['statFound', 'statNotFound', 'statFailed', 'statRemaining'].forEach(id => {
    document.getElementById(id).textContent = '0';
  });
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('progressCount').textContent = '0 / 0';
  document.getElementById('progressPct').textContent = '0%';
}

function addLogEntry(roll, result, status, errMsg) {
  const container = document.getElementById('logContainer');
  const el = document.createElement('div');
  el.className = 'log-entry';

  if (status === 'found') {
    el.innerHTML = `
      <span class="log-roll">${roll}</span>
      <span class="log-name">${result['Student Name'] || 'N/A'}</span>
      <span class="log-status status-found">✓ SGPA: ${result['SGPA'] || 'N/A'} | ${result['Result'] || 'N/A'}</span>`;
  } else if (status === 'not_found') {
    el.innerHTML = `
      <span class="log-roll">${roll}</span>
      <span class="log-name" style="color:var(--text-faint)">—</span>
      <span class="log-status status-not-found">Not Found</span>`;
  } else {
    el.innerHTML = `
      <span class="log-roll">${roll}</span>
      <span class="log-name" style="color:var(--text-faint)">Error</span>
      <span class="log-status status-error">Failed</span>`;
  }

  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function cancelJob() {
  cancelRequested = true;
  isScraping = false;
  showToast('Cancelling...', 'error');
  setTimeout(resetApp, 1200);
}

// ─── Done / Step 4 ────────────────────────────────────────────────────────────
function showStep4(total, notFoundCount, failedCount) {
  hide('step3');
  show('step4');

  const found = scrapedResults.length;
  document.getElementById('doneDesc').textContent =
    `Fetched ${found} student result${found !== 1 ? 's' : ''} for "${selectedLink.title}"`;

  document.getElementById('doneStatsBox').innerHTML = `
    <div class="done-stat"><span class="val" style="color:var(--success-light)">${found}</span><span class="lbl">Found</span></div>
    <div class="done-stat"><span class="val" style="color:var(--warn)">${notFoundCount}</span><span class="lbl">Not Found</span></div>
    <div class="done-stat"><span class="val" style="color:var(--danger-light)">${failedCount}</span><span class="lbl">Failed</span></div>
    <div class="done-stat"><span class="val">${total}</span><span class="lbl">Total Tried</span></div>`;

  const downloadBtn = document.getElementById('downloadBtn');
  if (found === 0) {
    downloadBtn.disabled = true;
    downloadBtn.style.opacity = '0.5';
    downloadBtn.title = 'No results to download';
  } else {
    downloadBtn.disabled = false;
    downloadBtn.style.opacity = '1';
    downloadBtn.title = '';
  }
}

function downloadExcel() {
  if (scrapedResults.length === 0) { showToast('No results to export', 'error'); return; }
  generateExcel(scrapedResults, selectedLink.title);
}

// ─── Excel Generation (in browser via xlsx-js-style) ─────────────────────────
function generateExcel(results, examTitle) {
  const XLSX = window.XLSX;
  if (!XLSX) { showToast('Excel library not loaded. Try refreshing.', 'error'); return; }

  const normalize = (v) => String(v || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const gradeTokens = new Set([
    'O', 'A+', 'A', 'B+', 'B', 'C', 'P', 'Q', 'R', 'F', 'ABSENT',
    'GRADE', 'GRADES', 'GRADE POINT', 'GRADE POINTS',
  ]);
  const isGradeLikeToken = (v) => gradeTokens.has(normalize(v));
  const isRealSubjectEntry = (s) => {
    const codeRaw = String(s['Code'] || '').trim();
    const nameRaw = String(s['Subject'] || '').trim();
    const code = normalize(codeRaw);
    const name = normalize(nameRaw);

    if (!code && !name) return false;
    if (isGradeLikeToken(code) || isGradeLikeToken(name)) return false;

    // Reject legend rows like "A+", "B", etc. that leak into parsed subjects.
    if (code && !name && code.length <= 3) return false;
    if (name && !code && name.length <= 3) return false;

    // Prefer rows that look like actual courses (code with digits or longer subject names).
    const codeLooksCourse = /\d/.test(codeRaw) || codeRaw.length >= 5;
    const nameLooksCourse = nameRaw.length >= 6;
    return codeLooksCourse || nameLooksCourse;
  };
  const subjectKey = (s) => {
    const code = normalize(s['Code']);
    const name = normalize(s['Subject']);
    if (code) return `C:${code}`;
    if (name) return `S:${name}`;
    return '';
  };

  // Build a stable subject catalog so every grade lands in the same column.
  const subjectMap = new Map();
  for (const r of results) {
    for (const s of (r['Subjects'] || [])) {
      if (!isRealSubjectEntry(s)) continue;
      const key = subjectKey(s);
      if (!key) continue;
      if (!subjectMap.has(key)) {
        const code = String(s['Code'] || '').trim();
        const name = String(s['Subject'] || '').trim();
        const label = name || code || key;
        subjectMap.set(key, { key, label });
      }
    }
  }
  const allSubjects = Array.from(subjectMap.values()).sort((a, b) => a.label.localeCompare(b.label));

  // S.No, Roll, Name, Father, subject grades..., SGPA, CGPA
  const totalCols = 4 + allSubjects.length + 2;
  const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const failedCount = results.filter(r => {
    const x = normalize(r['Result']);
    return x === 'FAIL' || x.includes('APPEAR');
  }).length;

  // ─── Simple report styles ───────────────────────────────────
  const S = {
    title: {
      font: { bold: true, sz: 15, color: { rgb: '1F3864' } },
      fill: { fgColor: { rgb: 'D9E1F2' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: allBorders('thin', 'B9C8DD'),
    },
    info: {
      font: { sz: 10, color: { rgb: '2C3E50' } },
      fill: { fgColor: { rgb: 'EDF2FA' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', 'D1DAEA'),
    },
    header: {
      font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '2F5597' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: allBorders('thin', '8EAADB'),
    },
    cell: {
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', 'D9D9D9'),
    },
    cellLeft: {
      alignment: { horizontal: 'left', vertical: 'center' },
      border: allBorders('thin', 'D9D9D9'),
    },
    cellNum: {
      alignment: { horizontal: 'center', vertical: 'center' },
      numFmt: '0.00',
      border: allBorders('thin', 'D9D9D9'),
    },
    cellAlt: {
      fill: { fgColor: { rgb: 'F9FBFF' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', 'D9D9D9'),
    },
    cellAltLeft: {
      fill: { fgColor: { rgb: 'F9FBFF' }, patternType: 'solid' },
      alignment: { horizontal: 'left', vertical: 'center' },
      border: allBorders('thin', 'D9D9D9'),
    },
    cellAltNum: {
      fill: { fgColor: { rgb: 'F9FBFF' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
      numFmt: '0.00',
      border: allBorders('thin', 'D9D9D9'),
    },
    gradeR: {
      fill: { fgColor: { rgb: 'F5B7B1' }, patternType: 'solid' },
      font: { bold: true, color: { rgb: '922B21' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', 'E6B0AA'),
    },
  };

  function allBorders(style, color = 'CCCCCC') {
    const b = { style, color: { rgb: color } };
    return { top: b, bottom: b, left: b, right: b };
  }

  // ─── Build worksheet data ──────────────────────────────────
  const ws = {};
  const enc = (r, c) => XLSX.utils.encode_cell({ r, c });

  // Row 0: Title
  ws[enc(0, 0)] = {
    v: 'RESULT COMPILER',
    t: 's', s: S.title,
  };

  // Row 1: Exam name
  ws[enc(1, 0)] = {
    v: examTitle,
    t: 's', s: S.info,
  };

  // Row 2: Summary (no pass column)
  ws[enc(2, 0)] = {
    v: `Generated: ${now}  |  Total Students: ${results.length}  |  Failed/Re-appear: ${failedCount}`,
    t: 's', s: S.info,
  };

  const sgpaCl = 4 + allSubjects.length;
  const cgpaCl = sgpaCl + 1;

  // Row 3: Headers
  const colHeaders = ['S.No', 'Roll No', 'Student Name', "Father's Name"];
  for (const sub of allSubjects) colHeaders.push(sub.label);
  colHeaders.push('SGPA', 'CGPA');

  colHeaders.forEach((h, c) => {
    ws[enc(3, c)] = { v: h, t: 's', s: S.header };
  });

  // Rows 4+: Data
  const dataStart = 4;
  results.forEach((result, i) => {
    const row = dataStart + i;
    const alt = i % 2 === 1;
    const cc = alt ? S.cellAlt : S.cell;
    const cl = alt ? S.cellAltLeft : S.cellLeft;
    const cn = alt ? S.cellAltNum : S.cellNum;

    ws[enc(row, 0)] = { v: i + 1, t: 'n', s: cc };
    ws[enc(row, 1)] = { v: result['Roll No'] || '', t: 's', s: cc };
    ws[enc(row, 2)] = { v: result['Student Name'] || '', t: 's', s: cl };
    ws[enc(row, 3)] = { v: result["Father's Name"] || '', t: 's', s: cl };

    // Subject grades
    const studentSubs = {};
    for (const s of (result['Subjects'] || [])) {
      if (!isRealSubjectEntry(s)) continue;
      const k = subjectKey(s);
      if (k) studentSubs[k] = s;
    }

    allSubjects.forEach((sub, si) => {
      const key = sub.key;
      const grade = (studentSubs[key] || {})['Grade'] || '-';
      const gradeStyle = grade.trim().toUpperCase() === 'R' ? S.gradeR : cc;
      ws[enc(row, 4 + si)] = { v: grade, t: 's', s: gradeStyle };
    });

    // SGPA, CGPA
    const sgpa = parseFloat(result['SGPA']) || result['SGPA'] || '';
    const cgpa = parseFloat(result['CGPA']) || result['CGPA'] || '';
    ws[enc(row, sgpaCl)] = { v: sgpa, t: typeof sgpa === 'number' ? 'n' : 's', s: typeof sgpa === 'number' ? cn : cc };
    ws[enc(row, cgpaCl)] = { v: cgpa, t: typeof cgpa === 'number' ? 'n' : 's', s: typeof cgpa === 'number' ? cn : cc };
  });

  // ─── Sheet metadata ────────────────────────────────────────
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: dataStart + results.length - 1, c: totalCols - 1 } });

  // Merge title/info rows
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: totalCols - 1 } },
  ];

  // Column widths
  const studentNameWidth = Math.min(34, Math.max(22, ...results.map(r => (r['Student Name'] || '').length + 4)));
  const fatherNameWidth = Math.min(34, Math.max(22, ...results.map(r => (r["Father's Name"] || '').length + 4)));
  const cols = [
    { wch: 6 },
    { wch: 16 },
    { wch: studentNameWidth },
    { wch: fatherNameWidth },
    ...allSubjects.map(sub => ({ wch: Math.min(28, Math.max(12, sub.label.length + 2)) })),
    { wch: 10 },
    { wch: 10 },
  ];
  ws['!cols'] = cols;

  // Row heights
  const rowHeights = [];
  rowHeights[0] = { hpt: 32 };
  rowHeights[1] = { hpt: 20 };
  rowHeights[2] = { hpt: 20 };
  rowHeights[3] = { hpt: 28 };
  ws['!rows'] = rowHeights;

  // Freeze panes after column D on first data row
  ws['!freeze'] = { xSplit: 4, ySplit: dataStart };
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3, c: totalCols - 1 } }) };
  ws['!margins'] = { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };

  // ─── Build workbook and download ──────────────────────────
  const wb = XLSX.utils.book_new();
  const sheetName = examTitle.replace(/[\\/*?:\[\]]/g, '').slice(0, 31) || 'Results';
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const filename = examTitle.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 60) + '.xlsx';
  XLSX.writeFile(wb, filename);
  showToast('Excel file downloaded!', 'success');
}

// ─── Reset App ────────────────────────────────────────────────────────────────
function resetApp() {
  cancelRequested = false;
  isScraping = false;
  scrapedResults = [];
  selectedLink = null;

  document.getElementById('startRoll').value = '';
  document.getElementById('endRoll').value = '';
  document.getElementById('skipRolls').value = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('rollPreview').style.display = 'none';

  hide('selectedExam');
  show('linksList');
  renderLinks(allLinks);

  document.getElementById('step2').style.opacity = '0.5';
  document.getElementById('step2').style.pointerEvents = 'none';

  show('step1'); show('step2');
  hide('step3'); hide('step4');
  resetStats();
}

// ─── Utilities ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(res => setTimeout(res, ms));

function show(id) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el) { el.classList.remove('hidden'); el.style.display = ''; }
}

function hide(id) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el) el.style.display = 'none';
}

let _toastTimer;
function showToast(msg, type = '') {
  clearTimeout(_toastTimer);
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}
