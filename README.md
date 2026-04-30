# EY Access Governance Platform

A production-grade web application consolidating four Oracle access governance tools into a unified platform.

## Tools

| # | Tool | Description |
|---|------|-------------|
| 1 | Entitlement Mapping | Map client entitlements to EY rulesets via privilege overlap + Jaccard similarity |
| 2 | False Positive Analysis | 3-level FP classification (FP / Single Leg / True Conflict) |
| 3 | Oracle Comparator | Compare RBAC and DSP across two Oracle environments |
| 4 | SOD & SA Analysis | Segregation of Duties and Sensitive Access violation detection |

## Running the Application

### Backend
```bash
cd governance_platform/backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd governance_platform/frontend
npm install
npm run dev
```

- App: http://localhost:5173
- API: http://localhost:8000
- API Docs: http://localhost:8000/docs

## Stack

- **Frontend:** React 18 · TypeScript · Vite 5 · Tailwind CSS 3 · Zustand · TanStack Table
- **Backend:** FastAPI · Polars · Pandas · rapidfuzz · xlsxwriter
