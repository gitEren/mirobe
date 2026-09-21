<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run Mirobe locally

Mirobe keeps model secrets on the server. Photo garment preparation and photo try-on use OpenRouter; paid live video uses FAL Lucy. Without provider keys, the app remains usable with the local segmentation and camera fallback.

## Run Locally

**Prerequisites:** Node.js


1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY` and, for paid video, `FAL_KEY`.
3. Optionally set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET` to persist generated assets as signed URLs.
4. Run the app: `npm run dev`

Useful development switches:

- `JEV_MODEL` — structured Jev decision model.
- `OPENROUTER_VISION_MODEL` — garment metadata model.
- `OPENROUTER_IMAGE_MODEL` — transparent garment and photo try-on model.
- `mirobe_plan` in localStorage — set to `premium` or `pro` to test paid UI locally.
