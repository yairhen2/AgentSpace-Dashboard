# AgentSpace Development Dashboard

Public static dashboard for tracking development of the private AgentSpace platform.

## How it works

- `data/checklist.json` is the source of truth.
- `app.js` reads the checklist and calculates progress.
- `index.html` provides the page structure.
- `styles.css` controls presentation.

Updating only `data/checklist.json` updates the dashboard automatically.

## Local preview

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## GitHub Pages

Repository **Settings → Pages → Deploy from a branch → main → /(root)**.
