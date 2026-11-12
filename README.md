# Fast and Safe Student Directory

A page that shows 5,000 students with search, class filter and sort, and stays fast: one database query on the server, a virtual list in the page (about 20 rows exist, not 5,000), and a broken record costs only its own row.

## Run

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
python -m uvicorn app.main:create_app --factory --port 8000
```

In a second window:

```powershell
cd frontend
npm install
npm run dev          # http://localhost:5173
```

## Test

```powershell
python -m pytest -q         # in backend: 22 tests
npm test                    # in frontend: 200 tests
npm run check:browser       # real Chromium, 15 checks (needs: npx playwright install chromium)
npm run measure             # speed table
python break47.py           # 65 deliberate mistakes (project folder)
```

See `SLOW_DEFINITION.md` for what "slow" means here.

See `DOCUMENTATION.md` for the full write-up.
