# Question bank spec (AWS SAA-C03 practice)

Each topic file is `data/questions/<topic>.json`: a JSON **array** of question objects.

```json
{
  "id": "s3-001",
  "topic": "s3",
  "domain": "secure",
  "type": "single",
  "difficulty": 2,
  "question": "A company stores ... Which solution will meet these requirements with the LEAST operational overhead?",
  "options": ["...", "...", "...", "..."],
  "answer": [2],
  "explanation": "Why the correct option(s) are right AND briefly why each other option is wrong.",
  "subtopic": "S3 Object Lock"
}
```

Field rules:
- `id`: `<topic>-NNN`, zero-padded, unique, sequential.
- `topic`: exactly the topic key given in your task.
- `domain`: one of `secure` (Design Secure Architectures, 30%), `resilient` (Design Resilient Architectures, 26%),
  `performance` (Design High-Performing Architectures, 24%), `cost` (Design Cost-Optimized Architectures, 20%).
  Pick the domain the question really tests. Across your file, try to cover all four roughly in the exam ratio where the topic allows.
- `type`: `single` (exactly 4 options, 1 correct) or `multi` (5 options with 2 correct, or 6 options with 3 correct).
  The question text of a `multi` MUST end with "(Select TWO.)" or "(Select THREE.)". ~20% of questions should be `multi`.
- `answer`: array of 0-based indices into `options`. Distribute the correct index evenly — do NOT favour A or the longest option.
- `difficulty`: 1 (recall/basic), 2 (typical exam), 3 (hard, subtle trade-off). Aim ~20% / 55% / 25%.
- `explanation`: 2–5 sentences. Explain the correct answer and why the distractors are wrong. Plain text, no markdown.
- `subtopic`: short label of the lesson/concept it tests (e.g. "NAT Gateway", "S3 Lifecycle").
- `source` (optional, required for new questions): the AWS documentation page that backs the correct answer,
  `https://docs.aws.amazon.com/...` (preferred) or an official `https://aws.amazon.com/...` page such as a service FAQ.
  The app links to it under the explanation. Every fact the question relies on must be on that page or in AWS docs.

Style rules (match the real exam):
- Mostly scenario-based: "A company ... The company needs ... Which solution will meet these requirements?" with
  qualifiers such as MOST cost-effective, LEAST operational overhead, MOST secure, highly available, etc.
  Up to ~25% may be shorter conceptual questions (still exam-flavoured, not trivia about obscure limits).
- Distractors must be plausible (real services/features used wrongly), similar length to the correct answer.
- Options must not say "All of the above" / "None of the above".
- Content must be technically correct as of 2025–2026 AWS (e.g. S3 is strongly read-after-write consistent; S3 Block
  Public Access + ACLs disabled by default on new buckets; SSE-S3 default encryption; Gateway endpoints only for S3 and
  DynamoDB; NAT Gateway is AZ-scoped and regional NAT gateway mode also exists; IAM Identity Center naming; Amazon Data
  Firehose naming; CloudFront OAC preferred over OAI; gp3 baseline 3000 IOPS/125 MiB/s; etc.). If unsure of a fact, do not
  use it.
- Original wording only. Do NOT copy questions from exam dumps, Udemy, Tutorials Dojo, or AWS sample questions.
- No duplicate questions within your file; vary scenarios (industries, numbers, requirements).
- English only. Valid JSON (UTF-8, double quotes, no trailing commas, no comments).

After writing, validate with:
`node C:/PROJECT/Personal/AWS/data/validate.js C:/PROJECT/Personal/AWS/data/questions/<topic>.json`
and fix every reported problem.
