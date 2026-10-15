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

## 1. Updating scores

### Live: the Google Sheet (preferred)

When `sheet_id` in `data/config.json` holds the ID of the scorecard as a Google Sheet, the site and the TV read the **Shuffled Matches** and **Finals** tabs straight from the sheet every 30 seconds. Type a score into the sheet and it appears within about half a minute, with the TV celebration. GitHub also refreshes the published data and the offline copy from the sheet every 30 minutes.

- The sheet must be shared as **Anyone with the link: Viewer**.
- Format the Score column as **plain text** (Format > Number > Plain text). Otherwise a score such as 21-5 can turn into a date. The site reads such dates back as day-month, but plain text avoids the problem.
- Keep the tab names and the header rows where they are (row 2 in Shuffled Matches, row 4 in Finals).

### Backup: upload the Excel (after each session)

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
- Team standings follow the **Best Team Ranking** sheet: 1 point per league win, 1 for each set won in a quarterfinal or semifinal (both sides, even in an unfinished tie), 5 for an event title, 3 for runner-up.

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

It loops by itself: the Race for Best Team, team standings and recent results, then each of the 7 events (group table and knockout draw), then the team cards. Each slide shows for 12 seconds (`tv_seconds` in `data/config.json`). New scores appear within a minute. Arrow keys skip slides; Esc exits. When a new score arrives the TV shows a short result banner with confetti, and a final win gets a Champion banner. Click **Chime off** once before entering TV mode to turn on a soft chime for new results (off by default).

A **Scan to cheer** QR code sits in the top right corner on every slide, celebrations included. It opens the cheer page on the public site (`public_url` in `data/config.json`), so it works from the offline copy too. Phones need the internet to cheer.

### Fan cheers (tap to support your team)

`cheer.html` (the site address ending in `/cheer.html`) lets anyone in the office pick their team and tap to cheer, from a phone or a desk. Share the link in Teams or by email; the TV race slide also shows a QR code to it. Each lane on the race shows its team's cheer count live, with bursts from the captain as cheers land, and the leading lane is marked "Loudest fans". Cheers never change team points.

Cheers are kept in a free Firebase Realtime Database. Its address goes in `cheer_db` in `data/config.json`; leave it empty to switch cheering off. The database rules only allow counters that go up by at most 25 per write (six cheer totals, plus one per team for each tug of war), and nothing about who cheered is stored. The race slide stays on screen longer while cheering is on (`tv_race_seconds`, default 20). The offline copy does not show cheers.

The cheer game:

- **Combos.** Fast, steady tapping builds a combo: x2 after 8 quick taps, x3 after 20, ON FIRE x5 after 40. A one-second pause resets it.
- **Fan levels.** Each person climbs Rookie (50 cheers), Ultra (250), Superfan (1,000) and Legend (5,000), with a level-up moment. Levels are kept on the person's own phone or browser.
- **Milestones and overtakes.** The TV announces when a team's fans reach 100, 250, 500, 1,000 cheers and every 1,000 after, and when one team's fans overtake another's.
- **Cheer Rush.** At the times in `cheer_rush` in `data/config.json`, every cheer counts double. Phones and the TV count down from 10 minutes before; during the rush the TV jumps to the race and holds it until the rush ends. Times are in the device's local time, every day, and an entry can carry a `date` to run once:

```json
"cheer_rush": [ { "start": "13:15", "end": "13:20" }, { "start": "18:15", "end": "18:20" } ]
```

- **Tug of war.** At the times in `tug_of_war`, all six teams pull at once, in three pairs. Each tap on the cheer page pulls that team's rope (and still counts as a cheer). The TV jumps to the three ropes, holds them until the pull ends, then shows the result with the winners for about 15 seconds. Phones show their own rope, the gap to the rival, and a countdown from 10 minutes before. Set the pairs for each pull; pairing teams close in the standings makes the best contests:

```json
"tug_of_war": [ { "start": "13:20", "end": "13:23", "pairs": [[2, 3], [4, 6], [1, 5]] } ]
```

To see it any time, add `?tugdemo` to the address: `.../?tugdemo#tv` on the TV and `.../cheer.html?tugdemo` on a phone run a practice pull with simulated rivals. Nothing is saved.

**Firebase rules.** In the Firebase console, open Realtime Database, then Rules, replace everything with this and click Publish. It keeps the cheer limits and adds the tug of war counters (one number per team per pull, same +25 limit). Until this is published, pulls do not register, but cheers carry on as before.

```json
{
  "rules": {
    "cheers": {
      ".read": true,
      "$team": {
        ".write": "$team.matches(/^[1-6]$/)",
        ".validate": "newData.isNumber() && newData.val() > (data.exists() ? data.val() : 0) && newData.val() <= (data.exists() ? data.val() : 0) + 25"
      }
    },
    "tug": {
      ".read": true,
      "$round": {
        "$team": {
          ".write": "$round.matches(/^[0-9]{8}-[0-9]{4}$/) && $team.matches(/^[1-6]$/)",
          ".validate": "newData.isNumber() && newData.val() > (data.exists() ? data.val() : 0) && newData.val() <= (data.exists() ? data.val() : 0) + 25"
        }
      }
    }
  }
}
```

### Smash (table tennis mini-game)

`game.html` (the site address ending in `/game.html`) is a one-minute table tennis game for phones and desktops. You slide your paddle to return the opponent's shots and aim your returns at targets on the far side (1, 3 or 5 points, multiplied by your rally combo). Three misses or 60 seconds ends the game. The score is added to your team's cheers (up to 200 a game, doubled during a Cheer Rush), and the captain's win or loss caricature appears at the end. Personal bests stay on the player's own device. It is linked from the cheer page, the race card and the TV QR code.

If a score can't be sent (no signal, or the database refuses it), the cheers are saved on that phone and sent automatically the next time the person plays or opens the cheer page.

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
- `cheer.html`, `assets/cheer.js`, `assets/cheer.css`, `assets/cheerdb.js`: the cheer page and the live cheer tally (Firebase REST API, no SDK). `assets/qrcode.js` (MIT) draws the QR code on the TV.
- `assets/sheetfeed.js`: reads the live Google Sheet (Google's visualization endpoint, no keys) with the same rules as `scripts/update_scores.py`.
- `scripts/build_offline.py`: packs the site and current scores into the single offline file `tt-offline.html`.
- `assets/fonts`: Roboto and Roboto Condensed (SIL Open Font License), self-hosted so the site does not depend on Google Fonts.
- `.github/workflows/publish.yml`: on every commit, runs the scripts and publishes the site to GitHub Pages.

To preview locally: `python scripts/update_scores.py && python -m http.server`, then open http://localhost:8000.

Brand: Roboto and Roboto Condensed; Yale Blue #204262 with Pale Sky #CAD8DE, Neon Ice #00F6ED, Salmon #E9806E and Blush Rose #E75A7C.
