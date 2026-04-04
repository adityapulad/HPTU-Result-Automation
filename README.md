# Result compiler 🎓

A web app that lets students fetch B.Tech exam results from the HPTU portal and download them as a styled Excel file — no installs needed.

**Live App:** [your-app.vercel.app](https://your-app.vercel.app)

---

## Features

- 📋 Fetches all B.Tech result links live from the HPTU portal (indiaresults.com)
- 🔍 Search and filter exams by branch/semester
- 🔄 Enter roll number range to bulk-fetch results
- 📊 Watch live progress as each student's result is fetched
- 📥 Download a beautifully styled Excel (.xlsx) file with:
  - Student name, father's name, roll number
  - All subject grades (Grade R highlighted in red)
  - SGPA, CGPA, Pass/Fail status (color-coded)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Excel Generation | [xlsx-js-style](https://github.com/gitbrent/xlsx-js-style) (browser-side) |
| Backend (API) | Python serverless functions (Vercel) |
| Hosting | [Vercel](https://vercel.com) |

---

## Deploy to Vercel

### Option 1: One-click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/hptu-result-automation)

### Option 2: Manual Deploy

1. **Fork / clone** this repo
2. Install [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
3. Run `vercel` in the project root and follow the prompts
4. Done! Your app is live.

Or deploy via **Vercel Dashboard**:
1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repo
3. Click **Deploy** — no configuration needed

---

## Project Structure

```
├── api/
│   ├── links.py          # Serverless: fetches B.Tech result links
│   └── result.py         # Serverless: fetches one student result
├── index.html            # Frontend UI
├── style.css             # Styles (dark glassmorphism theme)
├── app.js                # Frontend logic + Excel generation
├── vercel.json           # Vercel config (Python 3.12, 10s timeout)
├── requirements.txt      # Python dependencies
└── app.py                # Local development server (Flask)
```

---

## Local Development

```bash
# Install dependencies
pip install flask flask-cors requests beautifulsoup4 openpyxl

# Start local server
py -3 app.py         # Windows
python3 app.py       # Mac/Linux

# Open in browser
# http://localhost:5000
```

Or just double-click `start.bat` (Windows).

---

## How It Works

1. **`/api/links`** — Scrapes the HPTU listing page and returns B.Tech links
2. **`/api/result`** — For each roll number, fetches ASP.NET session tokens then POSTs to get the result HTML, parses and returns JSON
3. **Browser loop** — JavaScript calls `/api/result` for each roll number sequentially, shows live progress
4. **Excel download** — When done, xlsx-js-style generates the `.xlsx` file directly in the browser

---

## Notes

- The Vercel free (Hobby) plan has a **10 second** timeout per function call. Each student result takes ~2-3s (2 HTTP requests to HPTU), so this works fine.
- **Max 500 rolls** per run to prevent abuse.
- Results are fetched from the live HPTU portal — they reflect the official data.

---

## License

MIT
