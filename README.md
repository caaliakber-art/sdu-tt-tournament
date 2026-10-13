# SDU TT Tournament 2026

Website for the Singhvi Dev & Unni LLP office table tennis tournament. It has four tabs:

| Tab | What it shows | Where the data comes from |
|---|---|---|
| **Home** | Team standings, recent results, next matches, group standings per event, knockout draw and results | `scores/Score_Card.xlsx` (Shuffled Matches and Finals sheets) |
| **Teams** | Each team's players by event, with group position and win-loss | `scores/Score_Card.xlsx` and `data/config.json` |
| **Availability** | Each player's remaining matches and results, and how to reach the coordinator on Teams | `scores/Score_Card.xlsx` and `data/config.json` |

An optional **Photos** tab appears automatically once a OneDrive link is added to `data/config.json` (see section 2).

The site checks for new scores every minute, so a TV or an open Teams tab updates by itself.

---

## 1. Updating scores (after each session)

1. Open the repository on GitHub and go into the **scores** folder.
2. Click **Add file > Upload files**.
3. Drag in the latest **Score_Card.xlsx**. Keep that exact file name so it replaces the old one.
4. Click **Commit changes**.

About a minute later the site shows the new scores. You can watch progress under the **Actions** tab (green tick = live).

Rules for the Excel file:

- Keep the sheet named **Shuffled Matches** and keep the rows in the same order. Row order is the match number.
- Enter scores as `21-15` (Team 1 score first). Leave the score blank for matches not yet played.
- If something looks wrong (a typo, a winner that does not match the score), the Actions log lists it as a warning. The score column is always treated as the truth.

## Ranking rules (same as the scorecard)

- Group standings: 2 points per win; ties split on point difference, then team number. Top 4 go through.
- Q (qualified) and E (eliminated) are shown only once no remaining result can change them.
- Knockout draw and knockout scores are read straight from the scorecard's **Finals** sheet, so the site always shows the coordinator's draw.
- Team standings follow the **Best Team Ranking** sheet: 1 point per league win, 1 per quarterfinal or semifinal win, 5 for an event title, 3 for runner-up.

## 2. One-time setup

### Turn on the website (GitHub Pages)

Repository **Settings > Pages > Build and deployment > Source: GitHub Actions**.
The site address is `https://caaliakber-art.github.io/sdu-tt-tournament/`.

### Add it to Microsoft Teams

In the tournament channel, click **+** (Add a tab) > **Website**, name it `TT Tournament`, paste the site address, Save.
Everyone in the channel sees the live page without signing in to anything new. For the office TV, open the site in a browser and press **TV mode**, or open the address ending in `#tv`.

### Office TV slideshow

Open the site address ending in `#tv` (for example `https://caaliakber-art.github.io/sdu-tt-tournament/#tv`) on the TV's browser, a laptop connected by HDMI, or a casting stick, and make the browser full screen (F11 on a laptop).
Use a laptop or mini PC plugged into the TV by HDMI and open the page in its browser. Avoid Teams screen sharing for the TV: it compresses the animations, adds lag, and stops when the sharer's laptop sleeps or joins a call. A Fire TV Stick or Android TV box with a browser also works with the address directly.

It loops by itself: team standings and recent results, then each of the 7 events (group table and knockout draw), then the team cards. Each slide shows for 12 seconds (`tv_seconds` in `data/config.json`). New scores appear within a minute. Arrow keys skip slides; Esc exits. When a new score arrives the TV shows a short result banner with confetti, and a final win gets a Champion banner. Click **Chime off** once before entering TV mode to turn on a soft chime for new results (off by default).

### Offline copy (no internet at the TV)

Every publish also produces `tt-offline.html` (download it from `https://caaliakber-art.github.io/sdu-tt-tournament/tt-offline.html`, or run `python scripts/build_offline.py`). It is the whole site in one file: copy it to the TV laptop or a pen drive, double-click it, and click **TV mode**. It needs no internet, but its scores are frozen at the time it was made, so download a fresh copy after each scorecard update. The status chip reads "Offline copy" so nobody mistakes it for the live page.

### Today's matches (celebrations on the TV)

Each morning, copy the coordinator's lunch and post-office-hours lists into `today` in `data/config.json` as match numbers (row order in the scorecard):

```json
"today": { "date": "2026-10-13", "lunch": [79, 31, 41, 96, 65, 57], "evening": [20, 38, 42, 48, 49, 68, 71, 72, 80, 86, 95],
           "knockout": ["Mixed Doubles|Semifinal 1"] }
```

On the TV, every listed match that has a score gets its own winner celebration (11 seconds each, `tv_spot_seconds`; the score plays out point by point, knockouts set by set), and a "Still to play" slide lists the rest by session. As soon as the next scorecard upload adds a score, that match joins the celebrations automatically.

Each celebration also shows the captains' caricatures: the winning team's captain cheering on the left, the losing team's captain sulking on the right. The images live in `assets/art` and are listed per team under `team_art` in `data/config.json`. To change or remove one, edit or delete that team's entry.

### Optional: photos tab (OneDrive or SharePoint)

The Photos tab stays hidden until a link is set. To turn it on:

1. In OneDrive (or the Teams channel's Files tab), create a folder **TT Tournament 2026 Photos**.
2. Upload link: right-click the folder > **Request files** > copy the link into `photos_upload_url`.
3. Album link: right-click the folder > **Share** > **People in Singhvi Dev & Unni LLP** > copy the link into `photos_album_url`.

### Coordinator, team names and match dates

Edit `data/config.json` on GitHub (open the file, click the pencil icon, edit, **Commit changes**):

```json
"coordinator": { "name": "Akshith Tholakapalli", "email": "akshiththolakpalli@sdu.works" },
"team_names":  { "1": "Team 1", ... },
"captains":    { "1": "Captain name", ... },
"day_dates":   { "1": "2026-10-05", "2": "2026-10-06" },
"name_fixes":  { "Ali Akbar": "Ali Akber" }
```

`name_fixes` corrects spellings from the scorecard without editing the coordinator's file. `day_dates` is optional. When set, matches show the date, for example "Day 1, Mon 5 Oct".

## 3. Privacy

This repository and site are public. They contain player names, teams, fixtures, scores and the six captains' caricatures (`assets/art`). Keep each caricature only with that captain's agreement. Do not upload other photos, or personal contact details other than the coordinator's work email, to this repository.

## 4. How it is built

- `index.html`, `assets/styles.css`, `assets/app.js`: the site. Plain HTML, CSS and JavaScript, no build step.
- `scripts/update_scores.py`: reads `scores/Score_Card.xlsx` and writes `data/fixtures.json` and `data/results.json`.
- `scripts/build_offline.py`: packs the site and current scores into the single offline file `tt-offline.html`.
- `assets/fonts`: Roboto and Roboto Condensed (SIL Open Font License), self-hosted so the site does not depend on Google Fonts.
- `.github/workflows/publish.yml`: on every commit, runs the scripts and publishes the site to GitHub Pages.

To preview locally: `python scripts/update_scores.py && python -m http.server`, then open http://localhost:8000.

Brand: Roboto and Roboto Condensed; Yale Blue #204262 with Pale Sky #CAD8DE, Neon Ice #00F6ED, Salmon #E9806E and Blush Rose #E75A7C.
