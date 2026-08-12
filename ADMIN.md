# Adding work from the browser

Go to **`/admin`**, enter the password, pick an image, fill in the title,
description and category, and press Publish. The site rebuilds automatically and
the new work appears at the front of `/portfolio` in about a minute.

There is no database. The form commits the image and a `data/works.json` entry
straight into this repo, and Vercel's existing GitHub integration redeploys on
that push. That is the whole mechanism.

## One-time setup

Nothing works until these two secrets exist in Vercel. Until then `/admin`
loads but every upload answers *"Server is not configured"*.

### 1. Make a GitHub token

<https://github.com/settings/personal-access-tokens/new> — a **fine-grained**
token, not a classic one:

- **Repository access** → Only select repositories → `tazuuu/website`
- **Permissions** → Repository permissions → **Contents: Read and write**
- Nothing else. No other repo, no other permission.
- Set an expiry you will actually remember; uploads stop working the day it lapses.

### 2. Put both secrets in Vercel

Vercel project → Settings → Environment Variables:

| Name | Value |
|------|-------|
| `ADMIN_PASSWORD` | A long random string. Generate one, don't invent one. |
| `GITHUB_TOKEN` | The token from step 1. |

Optional, only if the repo or branch ever changes: `GITHUB_REPO`
(`owner/name`, defaults to `tazuuu/website`) and `GITHUB_BRANCH` (defaults to
`main`).

Redeploy once after adding them — environment variables are read at deploy time.

## Testing it locally

`serve.cmd` serves files only and cannot run `/api/upload`. Use:

```
npx vercel dev
```

with a `.env.local` file holding `ADMIN_PASSWORD` and `GITHUB_TOKEN`.
`.gitignore` already covers that file — keep it that way.

To check the validation logic without any network or secrets:

```
node test-upload.js
```

## What it does and does not do

- **Adds** works. Editing or deleting one means editing `data/works.json` and
  pushing — deliberately left out to keep the form small.
- Images are shrunk to 1600px wide in your browser before upload. A 6MB phone
  photo lands as roughly 250KB. This is not optional: Vercel rejects request
  bodies over 4.5MB, and every uploaded byte stays in the git history forever.
- Uploads are refused unless the file really is a JPEG, PNG or WebP. The check
  reads the file's leading bytes, so renaming `something.exe` to `.jpg` fails.
- Each upload makes two commits, so the history gets a little noisy. That is the
  price of having no database.

## If something goes wrong

| Message | Cause |
|---------|-------|
| *Server is not configured* | The two environment variables are missing, or you haven't redeployed since adding them. |
| *Wrong password* | `ADMIN_PASSWORD` doesn't match what you typed. |
| *GitHub rejected the image* | Token expired, or it lacks Contents: write on this repo. |
| *The image was saved but the works list could not be updated* | Two uploads collided, or the token lost write access mid-way. The image is committed but unreferenced; just publish again. |

## Known limits

- **No rate limiting on the password.** Vercel's free plan has no shared counter
  to hold attempt counts without adding another service. A long random password
  is the mitigation — this is why "don't invent one" is above.
- Uploaded titles are escaped when the portfolio renders them (`esc()` in
  `js/portfolio.js`). If that grid is ever rewritten, the escaping has to come
  with it, or an uploaded title becomes script running on your own site.
