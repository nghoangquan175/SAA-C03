# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SAA-C03 practice app, live at https://saa.quannh.xyz behind a login. It is a vanilla-JS single-page app with no npm dependencies and no framework. The question bank is JSON files, and the site is hosted on S3 + CloudFront, with a Lambda + DynamoDB API for cloud sync.

## Commands

```bash
npm start            # dev server on http://localhost:6699 (static files + bank built on the fly + local data API)
npm run validate     # validate every data/questions/*.json against QUESTION_SPEC.md
node data/validate.js data/questions/<topic>.json   # validate one file
npm run build        # validate, then write dist/ (public/* + bank.json)
API_DOWN=1 npm start # simulate the data API being down (sync falls back to local)
```

There is no test suite. `npm run validate` is the check for question changes. For UI changes, run `npm start` and look at the page.

## Architecture

- **Question bank:** `data/topics.json` lists the topics (key, group, title, icon, summary). `data/questions/<topic>.json` holds one array per topic. `scripts/bank.js` merges them: `server.js` serves the result as `/bank.json` in dev, and `scripts/build.js` writes it to `dist/bank.json`. The format and style rules are in `data/QUESTION_SPEC.md`, which covers ids, domain ratios, single/multi, answer-position spread, difficulty mix, the required `source` AWS docs link, and technical-accuracy notes. Read it before adding or editing questions.
- **App:** everything lives in `public/app.js`, an IIFE with hash routing (`route()` maps `#/exams`, `#/book/<topic>`, `#/quiz`, `#/result`, `#/review`, `#/history`…). The UI is rendered as HTML strings, with `esc()` on all text. State is one `store` object persisted to localStorage under `saa-practice-v1`.
- **Fixed practice exams are stable across releases.** `buildExams()` deals 65-question exams (domain targets 20/17/15/13) from per-domain pools. The pools are shuffled with seeded RNGs one *release* at a time. `RELEASES` in `app.js` records the last question id per topic in each release. **When you add questions, append a new `RELEASES` entry holding the current last ids**, so that exams people have already taken are never reshuffled.
- **Cloud sync** (the "Cloud sync" section of `app.js`): `attempts`, `qstats`, `bookmarks` and `book` (per-question notes and highlights) are written to localStorage first. They are then batched to `/api/data`, with keys waiting in `syncPending`/`syncWipe` until they reach the cloud. The newest `at` timestamp wins. `session`, `prefs` and `bookPos` stay on the device.
- **Data API:** `infras/api/index.mjs` is a Lambda function URL holding one DynamoDB table, `pk = kind`, `sk = id`. Validation lives in the shared `infras/api/rules.mjs`, and `server.js` imports the same rules for its local stand-in, which stores data in `.local/data.json`. Keep both in step when routes change.
- **Login gate:** `public/login.js` puts `SHA-256(username:password:salt)` in a cookie, and the CloudFront function `infras/auth-function.js` compares it with the hash in a KeyValueStore. The function also blocks the `*.cloudfront.net` hostname. `infras/scripts/set-password.sh` changes the login.

## Infra & deploy

- Every push to `main` triggers `.github/workflows/deploy.yml`, except changes only under `infras/**` or to `*.md`. It runs `npm run build`, assumes the deploy role through GitHub OIDC, runs `aws s3 sync dist --delete`, and invalidates CloudFront.
- `infras/` is Terraform, applied **by hand** with the `saa` AWS CLI profile (IAM user `saa-terraform`, policies in `infras/iam/`). The state file `infras/terraform.tfstate` is committed on purpose; commit it after every apply.

## Conventions

- Commit messages are a plain imperative sentence with no type prefix, e.g. `Filter book pages by domain and topic`.
- `example/` (review screenshots) and `.local/` are gitignored.
