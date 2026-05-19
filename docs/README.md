# GitHub Pages setup

Use this `docs/` folder as the GitHub Pages source.

## Steps

1. Push this project to GitHub.
2. Open the repository on GitHub.
3. Go to `Settings` -> `Pages`.
4. In `Build and deployment`, choose `Deploy from a branch`.
5. Select branch `main` and folder `/docs`.
6. Save.

GitHub will publish the site at:

```txt
https://YOUR_GITHUB_USER.github.io/YOUR_REPO/
```

## URLs for TikTok Developer Portal

Replace `YOUR_GITHUB_USER` and `YOUR_REPO` with the real values.

Terms of Service URL:

```txt
https://YOUR_GITHUB_USER.github.io/YOUR_REPO/terms.html
```

Privacy Policy URL:

```txt
https://YOUR_GITHUB_USER.github.io/YOUR_REPO/privacy.html
```

Web URL / Desktop URL / official website:

```txt
https://YOUR_GITHUB_USER.github.io/YOUR_REPO/
```

TikTok redirect URI:

```txt
https://YOUR_GITHUB_USER.github.io/YOUR_REPO/oauth/tiktok/callback.html
```

This static callback page redirects the TikTok OAuth `code` back to the local dashboard at:

```txt
http://localhost:4317/auth/tiktok/callback
```

Set the same HTTPS GitHub Pages callback URL in `.env`:

```env
TIKTOK_REDIRECT_URI=https://YOUR_GITHUB_USER.github.io/YOUR_REPO/oauth/tiktok/callback.html
```
