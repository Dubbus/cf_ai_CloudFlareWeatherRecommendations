Frontend demo (static)

Run the demo UI which hits the local Worker dev server at http://127.0.0.1:8787

1. Install dependencies (first time):

PowerShell
```
cd C:\Users\Adarsh Muralidharan\Desktop\Projects\cwta\frontend
npm install
```

2. Start the static server:

PowerShell
```
npm start
```

Open http://localhost:5173 in your browser (default `serve` port configured above).

Notes:
- The UI expects the Worker dev server to be running at http://127.0.0.1:8787 (run `npx wrangler dev` in `worker/`).
- CORS is permissive on the Worker side; the UI uses fetch to call `/state` and `/plan`.
