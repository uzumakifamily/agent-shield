# AgentShield Launch Checklist

**Date:** 4 May 2026  
**URL:** https://agentshield.allkinz.com  
**Status:** 🚀 Launch day

---

## Phase 1 — Code & Files

### Frontend
- [x] `public/index.html` — Favicon, apple-touch-icon, canonical URL
- [x] `public/index.html` — OG + Twitter Card meta tags
- [x] `public/index.html` — Plausible Analytics script
- [x] `public/index.html` — Footer: Privacy + Terms links added
- [x] `public/login.html` — `<meta name="robots" content="noindex, nofollow">`
- [x] `public/login.html` — Favicon, apple-touch-icon, Plausible script
- [x] `public/login.html` — Fake stats replaced with honest copy
- [x] `public/login.html` — Footer: Privacy + Terms links added
- [x] `public/dashboard.html` — `<meta name="robots" content="noindex, nofollow">`
- [x] `public/dashboard.html` — Favicon, apple-touch-icon, Plausible script
- [x] `public/dashboard.html` — Footer: Privacy + Terms links added
- [x] `public/privacy.html` — Created with full legal content (10 sections)
- [x] `public/terms.html` — Created with full legal content (14 sections)
- [x] `public/robots.txt` — Created (blocks /dashboard, includes sitemap URL)
- [x] `public/sitemap.xml` — Created (4 URLs, correct priorities)
- [x] `public/favicon.svg` — Created (shield icon, #ef4444)

### UI Polish
- [x] Testimonial cards — "Early tester" / "Beta tester" labels added
- [x] Testimonials — Disclaimer footnote added below section
- [x] Stats strip — 98% detection accuracy footnote added (`*`)
- [x] Warn-bar — "$47M+ in documented damages" (softened claim)

### Backend
- [x] `server.js` — Security headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, HSTS (on HTTPS origins)
- [x] `server.js` — Signup IP rate limiter: 5 attempts/hour/IP
- [x] `server.js` — Actions IP rate limiter: 100 requests/hour/IP
- [x] `server.js` — Static routes added for privacy.html, terms.html, robots.txt, sitemap.xml, favicon.svg
- [x] `server.js` — Global error handler (`fastify.setErrorHandler`)
- [x] `api/actions.js` — Input validation: action_type (string ≤100), context.agent (string ≤50), payload (object)
- [x] `api/health.js` — Updated to return `{ status, version: "1.0.0", timestamp }`
- [x] `.env.example` — Updated with all variables and descriptions
- [x] `README.md` — Rewritten with accurate AgentShield content and API reference

### Deployment
- [x] `Procfile` — `web: node server.js`
- [x] `.railwayignore` — node_modules, .db files, test files excluded
- [x] `DEPLOY.md` — Full 10-step Railway deployment guide

---

## Phase 2 — Pre-launch Verification

### Domain & DNS
- [ ] Domain `agentshield.allkinz.com` resolves to Railway service
- [ ] HTTPS working (TLS cert issued by Let's Encrypt via Railway)
- [ ] HSTS header present on HTTPS response
- [ ] www redirect working (or www subdomain not in use)

### Functional Tests
- [ ] `GET /health` → `{ status: "ok", version: "1.0.0", timestamp: "..." }`
- [ ] `GET /robots.txt` → returns correct content
- [ ] `GET /sitemap.xml` → returns valid XML
- [ ] `GET /privacy.html` → page loads correctly
- [ ] `GET /terms.html` → page loads correctly
- [ ] Homepage loads with no console errors
- [ ] Sign up flow: email → OTP → dashboard
- [ ] Login flow: existing account → dashboard
- [ ] Google OAuth flow (if Google credentials configured)
- [ ] Dashboard: create a rule, run a test action, verify verdict
- [ ] POST `/api/actions` with missing `action_type` → 400 error
- [ ] POST `/api/actions` with `action_type` > 100 chars → 400 error
- [ ] POST `/api/auth/signup` 6 times same IP → 6th returns 429

### Environment Variables
- [ ] `JWT_SECRET` — set, 32+ chars, unique (not the example value)
- [ ] `NODE_ENV=production`
- [ ] `DATABASE_PATH=/data/shield.db` (Railway volume)
- [ ] `BREVO_API_KEY` — set and tested (OTP email received)
- [ ] `EMAIL_FROM` — set to a Brevo-verified sender domain
- [ ] `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — set (if Google sign-in enabled)
- [ ] `ACCEPTANCE_TEST_KEY` — empty in production

### Analytics & SEO
- [ ] Plausible dashboard shows visitors on `agentshield.allkinz.com`
- [ ] Google Search Console: submit sitemap URL
- [ ] OG preview correct: paste URL into https://www.opengraph.xyz
- [ ] Twitter Card preview correct: paste URL into https://cards-dev.twitter.com/validator (or twittercard.io)
- [ ] No `og-image.png` 404 (either create the image or remove the meta tag)

### Security Checks
- [ ] Response headers include `X-Frame-Options: DENY`
- [ ] Response headers include `X-Content-Type-Options: nosniff`
- [ ] Response headers include `Strict-Transport-Security` on HTTPS
- [ ] `/dashboard.html` has `<meta name="robots" content="noindex">` (confirmed not indexed)
- [ ] `.env` is NOT committed to git (`git status` — confirm clean)
- [ ] `*.db` files are NOT in the git repo

---

## Phase 3 — Post-launch (Week 1)

### Monitoring
- [ ] Set up Railway uptime alerts (Settings → Notifications)
- [ ] Confirm Plausible tracking working after 24h
- [ ] Check Railway logs daily for unexpected errors

### Communication
- [ ] Submit to Product Hunt (if planned)
- [ ] Post launch announcement (Twitter/X, LinkedIn, relevant communities)
- [ ] GitHub repo: set description + topics (`ai-safety`, `agent`, `fastify`, `open-source`)
- [ ] GitHub repo: add `agentshield.allkinz.com` as the website URL

### First Users
- [ ] Test sign-up from a fresh incognito window on a different device
- [ ] Confirm OTP email arrives within 30 seconds
- [ ] Confirm dashboard loads after login with no errors
- [ ] Add first real agent integration using the SDK

---

## Known Outstanding Items

| Item | Priority | Notes |
|---|---|---|
| `og-image.png` | Medium | Create a 1200×630 social share image and upload to `/public/` |
| Email sending from freemail domains | Low | Brevo may throttle unless `EMAIL_FROM` uses a custom domain |
| Google OAuth redirect URI | Blocker if using Google sign-in | Must match exactly in Google Cloud Console |
| Volume mount on Railway | Blocker for data persistence | SQLite data lost without a mounted volume |

---

## Rollback Plan

If a critical issue is discovered post-launch:

1. In Railway dashboard → Deployments → find the previous successful deploy
2. Click **Redeploy** on the previous version
3. Investigate the issue in the failed deploy's logs
4. Fix and push a new commit

---

*Generated on 4 May 2026*
