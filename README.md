# 🎾 Court Availability

A single-page tool that checks open tennis court times across venues in
northern Sydney, in one view, with a 16-day weather outlook.

The thing it does that the booking sites don't: **find contiguous blocks**. Ask
for 90 minutes and it only shows starts where the next three 30-minute slots
are all free, across every court at every venue, filtered to the time window
you actually play in.

- Pick a date and a range of days (up to 2 weeks)
- Filter by slot length (30 / 60 / 90 / 120 min) and a from–to window
- Every listed time deep-links straight to that court's booking page
- Weather per day, so you can skip the wet ones
- Venue address, phone, email and a maps link on every card

## Venues

Eight of the fourteen are automatic. Two groups, two data sources:

| Venue | Source | How |
|---|---|---|
| Allan Small, Tyron, Roseville, Loyal Henry, Elizabeth | Ku-ring-gai Council (Bookable) | Automatic |
| Pennant Hills, Beecroft, Cowells Lane | tennisbcs.com.au | Automatic |
| Marsfield, GPA, Ryde, Artarmon, Vince Barclay, Midson | tennisvenues.com.au | Safari-assisted or manual capture — see below |

The Ku-ring-gai courts include unlit ones, where the council opens at sunrise
and closes at sunset. Those sunrise/sunset times are computed per date (NOAA
algorithm) so the app doesn't offer you slots after dark.

## The six tennisvenues venues

Marsfield, GPA, Ryde, Artarmon, Vince Barclay and Midson are on
tennisvenues.com.au, which does not permit other sites to read its
availability — its `robots.txt` disallows the data endpoint and an AWS WAF
challenge enforces it. **This app does not try to get around that.**

They still appear in the list with their address, phone, email and a maps
link. The app can also import times from an official page opened in your own
browser. The Safari userscript and manual bookmarklet read only the visible
booking links; neither copies cookies nor makes hidden requests.

## Use it

Open the published page. Nothing to install.

For local use, `start.command` (macOS: double-click) serves the folder at
<http://localhost:8777/index.html> and opens it.

Prefer the served URL over opening `index.html` off disk — Safari
extensions and some browser features don't work on `file://` pages.

### Automatic Safari capture (iPhone or Mac)

1. Install the free [Userscripts Safari extension](https://apps.apple.com/au/app/userscripts/id1463298887).
2. On iPhone, enable it under **Settings → Apps → Safari → Extensions**.
3. Open `court-capture.user.js` in Safari, open the Userscripts extension
   menu, and approve the installation.
4. Allow Userscripts on `tennisvenues.com.au`, then sign in to Tennis Venues
   once in Safari.
5. In Court Search, select a Tennis Venues location and press **Check
   Availability**. The capture starts automatically.

Safari opens the official selected-date page, the userscript reads the visible
times, sends them back to the Court Search tab, and asks Safari to close the
temporary tab. No copying, dragging, password access or cookie access is used.

### Capture selected venues and days

Install or update to `court-capture.user.js` version 1.1, then select the Tennis
Venues locations, starting date and Days filter. Every time **Check
Availability** is pressed, Court Search refreshes all selected Tennis Venues
pages first and then displays the results. The separate batch button can still
start or resume the capture manually, and its label shows the exact number of
pages. Court Search processes those venue/date pages one at a time in the same
Safari tab, with a short delay between pages. Slot length and From/To filters
are applied to the results after capture. Successful captures are kept if a
page fails or the batch is stopped.

### Manual capture fallback

1. Open **Safari setup for Tennis Venues** in the app.
2. Drag **Court Capture** to the bookmarks bar in Chrome or Safari.
3. Use **View official times** on a venue card to open the chosen date.
4. Click the Court Capture bookmark on that official page.
5. Return to Court Search, paste the copied data, import it, and press
   **Check Availability**.

Imported availability is stored locally for that venue and date. Capture it
again whenever you need fresher results.

## Fork it

You need your own proxy, because the council and BCS sites don't send CORS
headers and a browser can't call them directly.

1. **Deploy the Worker.** Cloudflare dashboard → Workers & Pages → Create →
   Worker. Paste `court-proxy-worker.js`, Deploy.
2. **Lock it down.** In that file, edit `ALLOWED_ORIGINS` to your own GitHub
   Pages origin. Skipping this leaves anyone who finds the URL able to proxy
   through your Cloudflare account.
3. **Point the page at it.** In `index.html`, set:
   ```js
   const PROXY = "https://court-proxy.<you>.workers.dev/?url=";
   ```
4. **Publish.** Repo → Settings → Pages → deploy from branch. Then set
   `ALLOWED_ORIGINS` to that Pages origin.

To change the venue list, edit `VENUES` (tennisvenues slugs), `KRG` (Bookable
venue ids), `BCS` (hostnames) and `DETAILS` (address / phone / email / map)
near the top of the script.

### Worker limits

The Worker allowlists which hosts it will forward to, checks `Origin`, and
applies in-memory burst limits (300 req/min per IP, 3000 global).

Be clear-eyed about what the `Origin` check buys you: browsers can't forge
that header, so it stops someone embedding your Worker in their own site. A
script can just omit it, so it is **not** security. The destination allowlist
is the real containment — the Worker can only ever talk to three domains.

The rate limits live in isolate memory, and Workers recycle isolates freely,
so treat them as free burst protection rather than a quota. For an actual
quota, add a Cloudflare Rate Limiting rule (Security → WAF → Rate limiting
rules), e.g. 600 requests per minute per IP on the Worker's route.

## How it works

Single HTML file, no build step, no dependencies, no framework.

| Source | Access |
|---|---|
| Ku-ring-gai (Bookable/Attekus) | JSON API via Worker; opening hours minus bookings, sunrise/sunset applied |
| tennisbcs.com.au | ASP.NET pages via Worker; POST-driven date and pagination, scraped |
| tennisvenues.com.au | Not fetched; optionally imported from a user-assisted capture of the visible official page |
| Open-Meteo | Called directly from the browser; free, no key, CORS-friendly |

**Every automatic check refetches.** Pressing *Check Availability* goes back to
the network for Ku-ring-gai and BCS venues and starts a fresh Safari capture for
the selected Tennis Venues locations. Court availability changes minute to
minute, so a cached answer for a fresh check would be wrong. Manually imported
captures remain local until they are replaced. Automatic results are cached only within a single
run. Lookups are capped at 5 concurrent. Failures aren't cached, so failed
venues retry on the next check. Venue, filter and imported-capture choices
persist in `localStorage`; the selected date does not.

The six tennisvenues venues are never fetched by the app. With no imported
capture their cards stay as official links; with a capture they show the saved
visible times and direct booking links.

A venue that fails to load is never shown as "0 slots" or hidden by *Hide
venues with no slots* — "we couldn't read it" and "there's nothing available"
are different answers and the UI keeps them distinct.

## Files

| File | |
|---|---|
| `index.html` | The whole app |
| `court-proxy-worker.js` | Cloudflare Worker CORS proxy — deploy your own |
| `start.command` | Serves the folder locally on port 8777 (macOS) |

## Limitations

- Availability is only as fresh as the moment you check; nothing is pushed
- Tennisvenues results require a user-assisted capture for each venue and date,
  and stay unchanged until captured again
- BCS venues are scraped from HTML, so a redesign there will break them
- Sydney daylight-saving offsets are computed, not looked up — correct under
  current rules, would need updating if those change
- Weather is a single forecast point for northern Sydney, not per venue
