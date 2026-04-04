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

  // Collect all unique subjects
  const allSubjects = [];
  const seenKeys = new Set();
  for (const r of results) {
    for (const s of (r['Subjects'] || [])) {
      const key = s['Code'] || s['Subject'] || '';
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        allSubjects.push(s);
      }
    }
  }

  const totalCols = 4 + allSubjects.length + 3; // S.No, Roll, Name, Father, subjects, SGPA, CGPA, Result
  const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const passCount = results.filter(r => (r['Result'] || '').toUpperCase() === 'PASS').length;
  const failOrReappearCount = results.filter(r => {
    const x = (r['Result'] || '').toUpperCase();
    return x === 'FAIL' || x.includes('APPEAR');
  }).length;
  const unknownCount = results.length - passCount - failOrReappearCount;

  // ─── Styles ────────────────────────────────────────────────
  const S = {
    title: {
      font: { bold: true, sz: 15, color: { rgb: '0B1F3A' } },
      fill: { fgColor: { rgb: 'EAF2FF' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: allBorders('thin', 'AFC3E0'),
    },
    subtitle: {
      font: { italic: true, sz: 10, color: { rgb: '334E68' } },
      fill: { fgColor: { rgb: 'F3F8FF' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', 'C7D7EF'),
    },
    meta: {
      font: { bold: true, sz: 9, color: { rgb: '1E3A5F' } },
      fill: { fgColor: { rgb: 'E6EEF9' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: allBorders('thin', 'C7D7EF'),
    },
    groupHeader: {
      font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1F4E78' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', '9BB2CE'),
    },
    header: {
      font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '2A5D9F' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: allBorders('thin', '9BB2CE'),
    },
    subHeader: {
      font: { italic: true, sz: 8, color: { rgb: '1F3864' } },
      fill: { fgColor: { rgb: 'D8E6F8' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: allBorders('thin', 'B6C8E0'),
    },
    cell: {
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', 'D5DCE6'),
    },
    cellLeft: {
      alignment: { horizontal: 'left', vertical: 'center' },
      border: allBorders('thin', 'D5DCE6'),
    },
    cellNum: {
      alignment: { horizontal: 'center', vertical: 'center' },
      numFmt: '0.00',
      border: allBorders('thin', 'D5DCE6'),
    },
    cellAlt: {
      fill: { fgColor: { rgb: 'F7FAFE' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', 'D5DCE6'),
    },
    cellAltLeft: {
      fill: { fgColor: { rgb: 'F7FAFE' }, patternType: 'solid' },
      alignment: { horizontal: 'left', vertical: 'center' },
      border: allBorders('thin', 'D5DCE6'),
    },
    cellAltNum: {
      fill: { fgColor: { rgb: 'F7FAFE' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
      numFmt: '0.00',
      border: allBorders('thin', 'D5DCE6'),
    },
    pass: {
      font: { bold: true, color: { rgb: '145A32' } },
      fill: { fgColor: { rgb: 'D5F5E3' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', 'AED6BF'),
    },
    fail: {
      font: { bold: true, color: { rgb: '7B241C' } },
      fill: { fgColor: { rgb: 'FADBD8' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', 'E6B0AA'),
    },
    warning: {
      font: { bold: true, color: { rgb: '7D6608' } },
      fill: { fgColor: { rgb: 'FCF3CF' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', 'F0D58A'),
    },
    gradeR: {
      fill: { fgColor: { rgb: 'F5B7B1' }, patternType: 'solid' },
      font: { bold: true, color: { rgb: '922B21' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', 'E6B0AA'),
    },
    empty: {
      fill: { fgColor: { rgb: 'EAF1FB' }, patternType: 'solid' },
      border: allBorders('thin', 'C7D7EF'),
    },
    legendLabel: {
      font: { bold: true, sz: 9, color: { rgb: '1E3A5F' } },
      fill: { fgColor: { rgb: 'EAF1FB' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: allBorders('thin', 'C7D7EF'),
    },
    note: {
      font: { italic: true, sz: 9, color: { rgb: '415A77' } },
      alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
      border: allBorders('thin', 'D5DCE6'),
    },
    cert: {
      font: { bold: true, sz: 9, color: { rgb: '0F3557' } },
      fill: { fgColor: { rgb: 'F6FAFF' }, patternType: 'solid' },
      alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
      border: allBorders('thin', 'D5DCE6'),
    },
    signLabel: {
      font: { bold: true, sz: 9, color: { rgb: '294A70' } },
      alignment: { horizontal: 'center', vertical: 'bottom' },
      border: allBorders('thin', 'D5DCE6'),
    },
    signLine: {
      font: { bold: false, sz: 9, color: { rgb: '6B7C93' } },
      alignment: { horizontal: 'center', vertical: 'top' },
      border: allBorders('thin', 'D5DCE6'),
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
    v: `RESULT COMPILER\n${examTitle.toUpperCase()}`,
    t: 's', s: S.title,
  };

  // Row 1: Subtitle
  ws[enc(1, 0)] = {
    v: 'Himachal Pradesh Technical University - Result Export Sheet',
    t: 's', s: S.subtitle,
  };

  // Row 2: Summary
  ws[enc(2, 0)] = {
    v: `Generated: ${now}  |  Total: ${results.length}  |  Pass: ${passCount}  |  Fail/Re-appear: ${failOrReappearCount}  |  Other: ${unknownCount}`,
    t: 's', s: S.meta,
  };

  const sgpaCl = 4 + allSubjects.length;
  const cgpaCl = sgpaCl + 1;
  const resCl = cgpaCl + 1;

  // Row 3: Group headers
  ws[enc(3, 0)] = { v: 'Student Details', t: 's', s: S.groupHeader };
  if (allSubjects.length > 0) {
    ws[enc(3, 4)] = { v: 'Subject Grades', t: 's', s: S.groupHeader };
  }
  ws[enc(3, sgpaCl)] = { v: 'Performance', t: 's', s: S.groupHeader };

  // Row 4: Headers
  const colHeaders = ['S.No', 'Roll No', 'Student Name', "Father's Name"];
  for (const sub of allSubjects) colHeaders.push(sub['Code'] || sub['Subject'] || '?');
  colHeaders.push('SGPA', 'CGPA', 'Result');

  colHeaders.forEach((h, c) => {
    ws[enc(4, c)] = { v: h, t: 's', s: S.header };
  });

  // Row 5: Sub-headers
  for (let c = 0; c < totalCols; c++) {
    if (c < 4 || c >= 4 + allSubjects.length) {
      ws[enc(5, c)] = { v: '', t: 's', s: S.empty };
    } else {
      const sub = allSubjects[c - 4];
      const name = sub['Subject'] || '';
      const cr = sub['Credit'] || '';
      ws[enc(5, c)] = { v: name + (cr ? `\n(Cr: ${cr})` : ''), t: 's', s: S.subHeader };
    }
  }

  // Rows 6+: Data
  const dataStart = 6;
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
      const k = s['Code'] || s['Subject'] || '';
      if (k) studentSubs[k] = s;
    }

    allSubjects.forEach((sub, si) => {
      const key = sub['Code'] || sub['Subject'] || '';
      const grade = (studentSubs[key] || {})['Grade'] || '-';
      const gradeStyle = grade.trim().toUpperCase() === 'R' ? S.gradeR : cc;
      ws[enc(row, 4 + si)] = { v: grade, t: 's', s: gradeStyle };
    });

    // SGPA, CGPA
    const sgpa = parseFloat(result['SGPA']) || result['SGPA'] || '';
    const cgpa = parseFloat(result['CGPA']) || result['CGPA'] || '';
    ws[enc(row, sgpaCl)] = { v: sgpa, t: typeof sgpa === 'number' ? 'n' : 's', s: typeof sgpa === 'number' ? cn : cc };
    ws[enc(row, cgpaCl)] = { v: cgpa, t: typeof cgpa === 'number' ? 'n' : 's', s: typeof cgpa === 'number' ? cn : cc };

    const resVal = result['Result'] || '';
    const resUpper = resVal.toUpperCase();
    const resStyle = resUpper === 'PASS'
      ? S.pass
      : (resUpper === 'FAIL' || resUpper.includes('APPEAR'))
        ? S.fail
        : (resUpper ? S.warning : cc);
    ws[enc(row, resCl)] = { v: resVal, t: 's', s: resStyle };
  });

  // Footer rows for a report-like finish
  const footerStart = dataStart + results.length + 1;
  const legendRow = footerStart;
  const noteRow = footerStart + 1;
  const certRow = footerStart + 2;
  const signLabelRow = footerStart + 4;
  const signLineRow = footerStart + 5;

  ws[enc(legendRow, 0)] = { v: 'Legend', t: 's', s: S.legendLabel };
  ws[enc(legendRow, 1)] = { v: 'PASS', t: 's', s: S.pass };
  ws[enc(legendRow, 2)] = { v: 'FAIL/RE-APPEAR', t: 's', s: S.fail };
  ws[enc(legendRow, 3)] = { v: 'OTHER STATUS', t: 's', s: S.warning };

  ws[enc(noteRow, 0)] = {
    v: 'Note: This sheet is generated digitally from portal data. Verify disputed entries with official university records.',
    t: 's', s: S.note,
  };
  ws[enc(certRow, 0)] = {
    v: 'Certified summary prepared by Result compiler for academic review use.',
    t: 's', s: S.cert,
  };

  const c1e = Math.max(0, Math.floor(totalCols / 3) - 1);
  const c2s = c1e + 1;
  const c2e = Math.max(c2s, Math.floor((2 * totalCols) / 3) - 1);
  const c3s = c2e + 1;

  ws[enc(signLabelRow, 0)] = { v: 'Prepared By', t: 's', s: S.signLabel };
  ws[enc(signLabelRow, c2s)] = { v: 'Checked By', t: 's', s: S.signLabel };
  ws[enc(signLabelRow, c3s)] = { v: 'Authorized Signatory', t: 's', s: S.signLabel };

  ws[enc(signLineRow, 0)] = { v: '____________________', t: 's', s: S.signLine };
  ws[enc(signLineRow, c2s)] = { v: '____________________', t: 's', s: S.signLine };
  ws[enc(signLineRow, c3s)] = { v: '____________________', t: 's', s: S.signLine };

  // ─── Sheet metadata ────────────────────────────────────────
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: signLineRow, c: totalCols - 1 } });

  // Merge title and subtitle rows
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: totalCols - 1 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 3 } },
    { s: { r: 3, c: sgpaCl }, e: { r: 3, c: resCl } },
  ];
  if (allSubjects.length > 0) {
    ws['!merges'].push({ s: { r: 3, c: 4 }, e: { r: 3, c: 3 + allSubjects.length } });
  }

  ws['!merges'].push(
    { s: { r: noteRow, c: 0 }, e: { r: noteRow, c: totalCols - 1 } },
    { s: { r: certRow, c: 0 }, e: { r: certRow, c: totalCols - 1 } },
    { s: { r: signLabelRow, c: 0 }, e: { r: signLabelRow, c: c1e } },
    { s: { r: signLabelRow, c: c2s }, e: { r: signLabelRow, c: c2e } },
    { s: { r: signLabelRow, c: c3s }, e: { r: signLabelRow, c: totalCols - 1 } },
    { s: { r: signLineRow, c: 0 }, e: { r: signLineRow, c: c1e } },
    { s: { r: signLineRow, c: c2s }, e: { r: signLineRow, c: c2e } },
    { s: { r: signLineRow, c: c3s }, e: { r: signLineRow, c: totalCols - 1 } },
  );

  // Column widths
  const studentNameWidth = Math.min(34, Math.max(22, ...results.map(r => (r['Student Name'] || '').length + 4)));
  const fatherNameWidth = Math.min(34, Math.max(22, ...results.map(r => (r["Father's Name"] || '').length + 4)));
  const cols = [
    { wch: 6 },
    { wch: 16 },
    { wch: studentNameWidth },
    { wch: fatherNameWidth },
    ...allSubjects.map(sub => ({ wch: Math.min(18, Math.max(11, (sub['Code'] || sub['Subject'] || '').length + 3)) })),
    { wch: 10 },
    { wch: 10 },
    { wch: 14 },
  ];
  ws['!cols'] = cols;

  // Row heights
  const rowHeights = [];
  rowHeights[0] = { hpt: 54 }; // title
  rowHeights[1] = { hpt: 18 }; // subtitle
  rowHeights[2] = { hpt: 20 }; // summary
  rowHeights[3] = { hpt: 24 }; // group headers
  rowHeights[4] = { hpt: 28 }; // headers
  rowHeights[5] = { hpt: 44 }; // sub-headers
  rowHeights[legendRow] = { hpt: 22 };
  rowHeights[noteRow] = { hpt: 24 };
  rowHeights[certRow] = { hpt: 22 };
  rowHeights[signLabelRow] = { hpt: 26 };
  rowHeights[signLineRow] = { hpt: 22 };
  ws['!rows'] = rowHeights;

  // Freeze panes after column D on the data start row
  ws['!freeze'] = { xSplit: 4, ySplit: dataStart };
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: 4, c: totalCols - 1 } }) };
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
