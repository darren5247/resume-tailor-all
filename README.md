# Resume Tailor

Paste a list of job URLs. For each one the site scrapes the job description, tailors your resume and a cover letter against it, scores the result for ATS fit, and hands back a `.docx` / `.pdf` pair plus a `.zip` — with live per-step progress and a Download All button.

It runs locally on your machine. Locally, your profile, API key and generated documents stay on disk. On Vercel they must live in Postgres — the serverless filesystem is wiped between requests, so a Save that only writes a JSON file looks successful and then disappears.

## Setup

```bash
npm install
npx playwright install chromium   # optional, see "Chromium fallback" below
npm run dev
```

Copy `.env.example` to `.env.local` if you want local runs to use the same Postgres database as production.

## Deploying to Vercel

Vercel functions cannot keep `data/profiles/` or `data/settings.json`. Add Neon Postgres and the app stores profiles and settings there automatically.

1. In the Vercel dashboard: **Storage → Create Database → Neon Postgres**.
2. Connect that database to this project. Vercel sets `DATABASE_URL` (and `POSTGRES_URL`) for you.
3. Redeploy. Tables are created on first request.
4. Fill in Profile and Settings again on the live site and press **Save**.

Local JSON under `data/` is gitignored, so a deploy never copies the profile you saved on your laptop. Point local `.env.local` at the same `DATABASE_URL` if you want one shared copy of that data.

## Profiles

The header **Profile** dropdown switches between saved people (Diego, Jomar, …). **New...** creates a blank profile, **Delete** removes the selected one, and **Save** persists the Profile tab form for the active person. Generate always uses whichever profile is selected in that dropdown.

Profiles are stored in Postgres when `DATABASE_URL` is set (Vercel). Locally, without a database, they still live under `data/profiles/` — one JSON file per person, plus `index.json` for the list and the active id.

## Templates

Open the **Templates** tab to pick a layout. The left list matches the reference app (Bold Accent through Emerald Cards). The right **Preview** updates immediately with either your active profile or a sample Alex Rivera resume. Selection is saved and used on the next Generate run.

## How a job is processed

Each URL runs through six steps, shown live on its card:

| Step | What happens |
| --- | --- |
| Scrape | Identify which applicant tracking system the URL belongs to |
| Fetch | Retrieve the job description text |
| Extract | Turn the posting into a structured spec: title, must-haves, nice-to-haves, keywords |
| Generate | Write the tailored resume and cover letter |
| Validate | Fact-check every claim against your profile and compute the ATS score |
| Zip | Render the `.docx` / `.pdf` files and package the folder |

### Fetching is a ladder, not a scraper

Each rung is more expensive and less reliable than the one above it, so the first usable result wins:

1. **The ATS's own public API.** Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, BambooHR, Recruitee, Comeet, Personio, Breezy, Teamtailor, Pinpoint, JazzHR (applytojob.com), Rippling, Gem, Jobvite, Hireology, JOIN (join.com), Dover (`/feed/v1/boards/{slug}/jobs`), iCIMS (`?in_iframe=1` JSON-LD/HTML), Oracle Cloud HCM (CE requisition details REST), UKG UltiPro (embedded OpportunityDetail payload), and Zoho Recruit (including custom hosts such as `jobs.conkord.com`) all publish job data as unauthenticated JSON/GraphQL or clean server-rendered HTML. No browser, no CAPTCHA, and the cleanest text available. A `?gh_jid=` or `?ashby_jid=` parameter on a company's own careers domain is recognised too. Custom domains that still publish Teamtailor's `/jobs.json` feed are detected from the `/jobs/{id}` URL shape. Zoho custom career sites are recognised from `/jobs/{portal}/{id}` and `?source=CareerSite`.
2. **`schema.org/JobPosting` JSON-LD** embedded in the served HTML, which covers a large share of boards nobody has written an adapter for.
3. **`__NEXT_DATA__`, embedded JSON blobs, then densest-text extraction.** Results from these rungs must also read like a job description, not a careers landing page, or they are rejected — a plausible-looking 600 characters of navigation is worse than an honest failure.
4. **Chromium**, for pages that ship no server-rendered content. While rendering, JSON XHR/fetch responses are also scanned for description fields.
5. **You.** A failed job turns into a red card with a textarea. Paste the description and press Generate with pasted JD; the scrape and fetch steps are skipped entirely.

LinkedIn, Indeed, Glassdoor and similar aggregators are skipped immediately rather than retried. They require a login, and the paste box is the intended path for them.

### Nothing gets invented

A tailored resume that invents a job gets you rejected, not hired, so fabrication is blocked structurally rather than asked for politely:

- The model never writes your employers, titles, dates, schools or certifications. It only supplies bullets, keyed to a real experience id, and everything else is copied from your profile at render time.
- Skills are filtered against your profile's skill pool. Anything else is dropped.
- A deterministic check then rejects: posting keywords asserted as your experience but absent from your profile, figures that appear nowhere in your profile, and any years-of-experience claim above what your profile states.
- Violations trigger exactly one repair round-trip. Anything still unsupported after that is reported on the card and costs the job ATS points, rather than being retried forever.

### The ATS score

Out of 100: must-have keyword coverage (50), nice-to-have coverage (20), title and seniority alignment (15), and formatting checks such as a parseable contact block and dated roles (15). Unresolved fact-check issues subtract up to 20. Every job's card can show which posting keywords are still missing.

## Output

Each job writes a dated folder under your output directory:

```
output/2026-08-02_acme-corp_senior-data-engineer/
  Resume-Juan.docx
  Resume-Juan.pdf
  Coverletter-Juan.docx
  job-description.txt
  metadata.json
  acme-corp-senior-data-engineer.zip
```

The zip contains the same documents (resume DOCX + PDF, cover letter, job description, metadata) for one-click sending.
`metadata.json` records the source URL, which rung of the ladder produced the description, the model used, the ATS breakdown, matched and missing keywords, warnings, and token cost.

All four templates are single column with no tables, text boxes, headers or footers, and use standard section names. Only fonts, colours and rules differ between them.

## Chromium fallback

`npx playwright install chromium` downloads about 150 MB. Without it the app still runs and simply loses the fourth rung of the ladder; it will tell you so in the failure detail. You can also turn the rung off in Settings.

Re-run that command after any Playwright upgrade. Each release pins a browser build, so an `npm install` that bumps Playwright leaves the old build on disk and quietly disables the rung until the matching one is downloaded.

## Testing the scraper without spending tokens

```bash
npm run scrape -- urls.txt
npm run scrape -- https://jobs.lever.co/acme/1234 --show
npm run scrape -- urls.txt --no-browser
```

This runs the full fetch ladder and reports which rung answered for each URL, how many characters it produced, and, for failures, what every rung reported. It is the fastest way to find out that an ATS changed its URL shape.

## Cost

Two model calls per job normally, three when the fact check requires a repair, plus one when you import a resume. Thirty jobs on `gpt-4.1` is roughly a dollar. The progress panel shows a running token and cost total, and Settings lets you switch to a cheaper model.

## Layout

```
app/          pages and API routes
components/   the three screens
lib/
  scrape/     the fetch ladder, adapters/ holds one file per ATS
  llm/        prompts, schemas, the fact-check validator
  docx/       resume and cover letter renderers, packaging
  pipeline/   run store, batching, the six-step state machine
  score/      ATS scoring
scripts/      the scrape harness
data/         local profile, settings and run history when Postgres is not configured (gitignored)
output/       generated packets (gitignored)
```
