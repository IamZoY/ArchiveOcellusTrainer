# Archive Ocellus Trainer

A free practice simulator for the Ocellus fight in The Fractured Archive.

**Status: early development.** Mechanics come from the community wiki and release-day reports. Timings are unverified and will change.

Play it at https://archive-ocellus-trainer.raid-sims.workers.dev. The site opens the full fight at phase 4. Pick another phase from **Start at** in the side panel and press **Start fight**. Tick **Practice** to play without dying. Hold Control while clicking a tile to walk there instead of running, as in game. The fight waits until you press **Start**, so you can set keybinds and settings first. Press **P** or **Pause** to pause; keybinds and settings work while paused, and the fight resumes on the same tick.

Built on [osrs-sdk](https://github.com/OldSchoolSDK/osrs-sdk), following the layout of [ColosseumTrainer](https://github.com/Supalosa/ColosseumTrainer).

## Development

Requires Node 22.

```sh
npm ci
scripts/install-beta-sdk.sh     # beta osrs-sdk packages, installed without saving; rerun after any npm ci
npm run assets -- --cache-dir <openrs2 cache dir> --reader-path <osrscachereader checkout>
npm start                       # http://127.0.0.1:8002
```

`npm run assets` extracts models from OpenRS2 cache 2746 into `public/osrs-assets/`, which is never committed. It then draws an inventory icon for each of the trainer's own items, and for the Masori (f) pieces and Zaryte vambraces, from the item's model in the same cache, the way the game client draws it, into `public/osrs-assets/item-icons/`, and writes the boss's overhead icons from the cache's sprite index into `public/osrs-assets/sprites/`. `npm run item-icons` with the same two options redraws only the icons. `npm start` and `npm run build` first run `src/assetBundle/check.ts`, which fails and names each missing key when `public/osrs-assets/` comes from another cache or lacks an asset that `src/assets.ts` configures: in `build-info.json`, in `manifest.json`, as a payload file the manifest names, or in the sound pack. The page logs one `assets:` console error for each configured NPC, model or spotanim its served manifest lacks. The icon renderer in `src/itemIcons/` is ported from RuneLite's cache tool under its BSD 2-clause licence.

## Co-op

Several people can train one fight together. One of you hosts: **Co-op** in the side panel gives a six-letter code,
and everyone else types it in or opens the link, which carries `?room=CODE`. When all are ready the host starts, and
every client runs that fight from the host's seed, so the boss's timings, cracks, rifts and explosions are the same
for everyone. You see each other walk, swing and pray live, each in their own gear, and a player who dies leaves the
arena and keeps watching someone who is still up. A swing crosses as the fact of it, not as an animation: the tick
says that player attacked and whether it was a special, and their own figure plays what the weapon in its hands
would, facing the boss to do it. Gear travels as names and item ids rather than a wardrobe: the
tier each player picked dresses them until their first report lands, after which every client builds what they have
on from its own catalog, so a swap mid-fight shows up on everyone's screen. A tier changed in the Loadout editor shows
others the tier it started from, marked with a star.

The boss is on one person at a time. Every client points its fight at whoever the room agreed the boss is on, so the
damage lands on that person's machine and on nobody else's; the host is the one that says who that is and what each
hit did. A guest that opened the page on a different seed reloads onto the host's and rejoins by itself.

**Run it again** puts the team back in the lobby with everyone still ready, so the next attempt is one click for the
host and none for anyone else. A room holds one of each name, and a seat survives a reload or a dropped connection
for 45 seconds, so coming back lands you in your own seat rather than a new one; a seat nobody has answered for in
twelve seconds goes back to whoever gives that name, which is how a crash or a closed browser returns as itself.

Nobody joins a fight halfway, because every client runs it from its seed from the first tick. A code typed while a
fight is on takes a seat for the next run and waits in the lobby, and the host's **Restart the fight** starts that
run for the whole room.

The fight itself belongs to the room, not to a page. **Start at**, **Start fight**, **Restart** and the result's
retry are the host's while a room is open: each of them moves the room to that seed and that starting phase, and
every other client loads the page again on it. A guest's copies are disabled, since a page that restarted on its
own would be running a fight nobody else is in.

A report is relayed in the turn the server hears it, and the sockets are set to send a small frame rather than wait
to fill one, so a step costs one trip and nothing else. The rest of what you see is the game's own: every client
anchors its tick to the start of the run, so a friend's step lands on your screen a tick after they took it, which
is where it lands in game too.

The room server carries the words between machines and holds no fight of its own. It serves the built site too, so a
VPS needs one process:

```sh
npm ci
scripts/install-beta-sdk.sh
npm run assets -- --cache-dir <openrs2 cache dir> --reader-path <osrscachereader checkout>
npm run build
npm run serve -- --port 8080 --dist dist
```

Put it behind a TLS terminator and make sure that proxy does **not** buffer responses, or the event stream arrives in
lumps: for nginx, `proxy_buffering off;` and `proxy_read_timeout 1h;` on the `/mp/` location. Rooms live in memory, so
restarting the server ends every fight in progress. A room holds at most 8 players, empties when its last stream
closes, and hands the host seat on if the host leaves.

## Review

CI keeps the OpenRS2 download, pinned cache reader and validated SDK packs in its `netlify-cache` directory. The key hashes `scripts/netlify-build.sh`, `osrs-assets.config.ts` and `scripts/install-beta-sdk.sh`, covering the reader pin, OpenRS2 cache ID and SDK pin. A key miss restores a previous `osrs-cache-` entry. The build removes other OpenRS2 cache IDs, and the installer removes old SDK packs while holding its cache lock only when `NETLIFY_CACHE_DIR` is set. Shared developer caches retain packs for every SDK pin. The assets job gives its base build a separate cache copy. The build checks the OpenRS2 cache ID and metadata, selects the reader by commit and validates the SDK packs against the SDK pin before reuse. An asset build that fails after an archive download reports its URL and received byte count beside the original error.

After installing the SDK, run `node --test scripts/ci-cache.test.mjs scripts/assets.test.mjs` to check cache key inputs, restore prefixes and corrupt-download diagnostics through `npm run assets`. The download tests replace only OpenRS2 HTTP responses. Run `scripts/verify.sh t0` during iteration and `scripts/verify.sh t1` before handoff, then read the full CI result with `scripts/verify.sh ci`.

Read [CODE_REVIEW.md](CODE_REVIEW.md) before you review a change. It lists the performance red flags and explains `scripts/verify.sh perf`, which measures draw calls, canvas size, GPU resource growth, frame time and tick timing against the budgets in `src/perf/perfGate.json`.

CI replays each pull request's test changes over its base with `review-ratchet/checks/replay-controls.mjs`. A test whose own source did not change must still pass there. When a pull request changes a shared test fixture on purpose, it lists each test that the change makes fail on the base in `review-ratchet/replay-acknowledged.json`, with a reason, and the reviewer checks that list. Only entries the pull request adds or changes count. An entry fails the check when it does not name an unchanged test that passed on the base, or when that test passes after the overlay, or when more than one test has its name. The check guards against honest mistakes, not an author who means to deceive it. It still rejects an acknowledged test that has no result, is skipped or sits in a file with an error outside its tests. It cannot tell whether an acknowledged test failed in its own body or in a hook or cleanup around it, so that call belongs to the reviewer.

## Releases

Each pull request that changes what players see adds one plain-language line to `src/content/ocellus/changelog.ts`. The line goes in the newest release if `src/content/ocellus/shipped-releases.json` does not list that release. Otherwise it goes in a new release, versioned by the day it ships: `YYYY.MM.DD`, or `YYYY.MM.DD.2` for a second release that day. Players read the notes under **About**, then **What's new**, and `node scripts/release-notes.mjs` prints the newest release as Markdown for a GitHub release. Before a deploy, `node scripts/release-notes.mjs --record-shipped --since VERSION`, where VERSION is the last shipped release, adds every release that the deploy publishes to `shipped-releases.json` and prints their notes for the GitHub release. Without `--since`, it records and prints the newest release only. From then on the script rejects the changelog if a recorded release's notes change, or if the release is removed while an older one is still listed. What's new shows the whole changelog, and the page script carries it, so the changelog holds at most five releases. To add a sixth, drop the oldest; its notes stay on GitHub Releases, which What's new links to under **Older releases**.

The gear tiers and the Loadout editor are not released yet. `scripts/release-build.sh` builds with `ARCHIVE_LOADOUT=raid`, which leaves the Tier picker and the Loadout button off the page, ignores `tier=` links, and starts every run on the Raid gear. `ARCHIVE_LOADOUT=tiers` offers the tiers without the editor. Every other build, including `npm start`, `scripts/verify.sh` and Netlify previews, defaults to `editor`, which has both. To release the tiers, set `tiers` in `scripts/release-build.sh`, and to release the editor too, remove that line.

## Privacy

To find what causes lag, a sample of runs sends one anonymous performance summary when the run ends or the page is hidden mid-run. It holds the frame and tick timings, the view (always 3D), the screen scale and game size rounded to 50 pixels, the CPU core count, the graphics card family (such as `nvidia` or `apple`, never the full name), the browser family, the app version, the phase and how the run ended. It carries no ID, sets no cookie and stores nothing that identifies a player, and the trainer's code does not store IP addresses. Page views are counted with Cloudflare Web Analytics, which sets no cookies. Web Analytics loads on every page view unless you opt out. Only the performance summary is sampled. To turn both off, open **Settings** and untick **Send anonymous performance data**. The choice is saved in the browser. The summary stops at once, and page view counting stops from the next page load.

The share of runs that send a summary is `sampleRate` in `src/telemetry.json`, served as `/telemetry.json`. The Worker in `src/worker/worker.ts` accepts summaries at `/t` and writes each one to Workers Analytics Engine. `scripts/perf-report.mjs` summarises them.

Releases send the summary from about 1 run in 10. `sampleRate` is 0.1, and `wrangler.release.jsonc` binds `PERF` to the `archive_ocellus_perf` dataset. Web Analytics is not set up yet, so the release build refuses `CF_WEB_ANALYTICS_TOKEN` and pages load no Web Analytics script. In a release, the opt-out box is **Performance data** under **About** in the sidebar, which is in **Menu** on a phone.

## Credit

Made by Julian Dasilva / Moarhots ([@ShadowJdas](https://x.com/ShadowJdas) on X), with help from [Alessandro Rodi](https://github.com/alessandrorodi).

Created using intellectual property belonging to Jagex Limited under the terms of Jagex's Fan Content Policy. This content is not endorsed by or affiliated with Jagex.

Game models are extracted, and item icons drawn, from the game cache at build time. Neither is stored in this repository.

## Licence

GPL-3.0. See [LICENSE](LICENSE).
