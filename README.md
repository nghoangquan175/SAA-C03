# AWS SAA-C03 Practice

Practice app for the AWS Certified Solutions Architect – Associate (SAA-C03) exam.
Dark-mode UI, English questions, no dependencies. Live at https://saa.quannh.xyz (login required).

```bash
npm start          # local dev server: http://localhost:6699
npm run validate   # check every question file
npm run build      # static site in dist/ (public/* + bank.json)
```

- **Practice exams** — 65 questions, 130-minute timer, domain mix 20/17/15/13 (Secure / Resilient / High-Performing / Cost), results only after submitting. Exams are dealt from the question pool without overlap.
- **Topic quizzes** — one per course section, filter by subtopic, difficulty, unseen or previously wrong questions; practice mode gives instant feedback.
- **Review mistakes / bookmarks / history** — progress is stored in the browser's localStorage (History → Export to back it up).

Questions are original, written in the exam's style — not real exam questions.
Add more by appending to `data/questions/<topic>.json` (format in `data/QUESTION_SPEC.md`).

## Hosting

```
Cloudflare DNS (saa CNAME, DNS only) → CloudFront (ACM *.quannh.xyz, login gate function) → private S3 bucket (OAC)
```

- `infras/` — Terraform for the bucket, CloudFront, the login gate and the GitHub deploy role. Run with the
  `saa` AWS CLI profile (IAM user `saa-terraform`, policy in `infras/iam/`). State is committed in this folder.
- Login — `public/login.js` stores `SHA-256(username:password:salt)` in a cookie; the CloudFront function
  `infras/auth-function.js` compares it with the hash in the CloudFront KeyValueStore.
  Change the login with `infras/scripts/set-password.sh` (signs out every session).
- Deploy — GitHub Actions builds the site, syncs `dist/` to S3 and invalidates CloudFront on every push to `main`.
