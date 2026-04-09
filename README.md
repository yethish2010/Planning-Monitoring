<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app



## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Production Notes

This app is a full-stack Node.js app with an Express server and a SQLite database.
It is not a static-only deployment.

Environment variables:

- `VITE_GEMINI_API_KEY`
- `APP_URL`
- `JWT_SECRET`
- `DATABASE_PATH`

`DATABASE_PATH` lets you store the SQLite file on a persistent disk instead of the project root.
That makes the current setup much safer on free or low-cost hosting platforms that support mounted storage.

Example:

```env
DATABASE_PATH=/var/data/campus.db
```

Recommended hosting for the current architecture:

- Render with a persistent disk
- Railway with persistent volume support
- A small VPS

Static-only hosts such as GitHub Pages or Netlify are not suitable for this backend.
