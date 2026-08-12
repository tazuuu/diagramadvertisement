# Managing portfolio work from the browser

Go to **`/admin`** and enter the password. From there you can:

- **Add** a work — pick an image, fill in title, description and category
- **Edit** one — change any field; leave the image empty to keep the current one
- **Delete** one — removes the entry *and* its image from the repo

Each change rebuilds the site, so give it about a minute to appear on
<`/portfolio`>.

There is no database. The page commits changes straight into this repo, and
Vercel's existing GitHub integration redeploys on that push. That is the whole
mechanism.

## One-time setup

Nothing works until these two secrets exist in Vercel. Until then `/admin`
loads but answers *"Server is not configured"*.

### 1. Make a GitHub token

<https://github.com/settings/personal-access-tokens/new> — a **fine-grained**
token, not a classic one:

- **Expiration** → **No expiration**
- **Repository access** → Only select repositories → `tazuuu/website`
- **Permissions** → Repository permissions → **Contents: Read and write**
- Nothing else. No other repo, no other permission.

The expiration setting is the important one. A dated token stops working the day
it lapses, with no warning — uploads simply start failing. "No expiration" avoids
that, at the cost of a credential that lives until you revoke it. Paste it into
the Vercel environment variable and nowhere else: not into a file in this repo,
not into a chat message, not into a note.

### If the token is ever exposed

Revoke first, ask questions later — it takes under a minute:

1. <https://github.com/settings/personal-access-tokens> → the token → **Revoke**
2. Create a replacement with the same two settings above
3. Update `GITHUB_TOKEN` in Vercel and redeploy

The old token is dead the moment you revoke it. The worst it could have done in
the meantime is write to this one repository, which is why it is scoped that way.

### 2. Put both secrets in Vercel

Vercel project → Settings → Environment Variables:

| Name | Value |
|------|-------|
| `ADMIN_PASSWORD` | Your choice, **minimum 12 characters** — the server refuses to run below that. |
| `GITHUB_TOKEN` | The token from step 1. |

Optional, only if the repo or branch ever changes: `GITHUB_REPO`
(`owner/name`, defaults to `tazuuu/website`) and `GITHUB_BRANCH` (defaults to
`main`).

Redeploy once after adding them — environment variables are read at deploy time.

### Picking the password

Make it something you will remember, but make it a **phrase, not a word**.
Three or four unrelated words beats a short mangled one on both counts —
easier to recall and far harder to guess:

- Good: `bluecouch-ajman-tuesday`, `sixteen-orange-signboards`
- Weak: `Diagram@2026`, `admin123456` — short, and the first thing anyone tries

Five wrong attempts lock that address out for 15 minutes, so guessing is slow.
That is a backstop, not a substitute for a decent phrase.

## Testing it locally

`serve.cmd` serves files only and cannot run `/api/works`. Use:

```
npx vercel dev
```

with a `.env.local` file holding `ADMIN_PASSWORD` and `GITHUB_TOKEN`.
`.gitignore` already covers that file — keep it that way.

To check the validation logic without any network or secrets:

```
node test-works.js
```

## Good to know

- Images are shrunk to 1600px wide in your browser before upload. A 6MB phone
  photo lands as roughly 250KB. This is not optional: Vercel rejects request
  bodies over 4.5MB, and every uploaded byte stays in the git history forever.
- Uploads are refused unless the file really is a JPEG, PNG or WebP. The check
  reads the file's leading bytes, so renaming `something.exe` to `.jpg` fails.
- Deleting removes the image file too, so the repo doesn't accumulate orphans.
  Replacing an image on edit deletes the old one the same way.
- Each change makes one or two commits, so the history gets a little noisy.
  That is the price of having no database.
- The eight original works are still hardcoded in `js/portfolio.js` and do not
  appear in the admin list. Uploaded works are shown *before* them on the
  portfolio page.

## If something goes wrong

| Message | Cause |
|---------|-------|
| *Server is not configured* | The two environment variables are missing, or you haven't redeployed since adding them. |
| *ADMIN_PASSWORD must be at least 12 characters* | Exactly that. Lengthen it in Vercel and redeploy. |
| *Wrong password* | It doesn't match `ADMIN_PASSWORD`. |
| *Too many wrong passwords* | Five failures from your address. Wait 15 minutes. |
| *GitHub rejected the image* | Token revoked, or it lacks Contents: write on this repo. |
| *That work no longer exists* | The list on screen is stale — reload the page and unlock again. |
| *Could not update the works list* | Two changes collided, or the token lost write access mid-way. Try again. |

## Known limits

- **The lockout is per server instance and resets on cold start.** Vercel's free
  plan has no shared counter without adding another service, so a determined
  attacker with many addresses could work around it. This is why the password
  should be a phrase.
- Uploaded titles are escaped when the portfolio renders them (`esc()` in
  `js/portfolio.js`). If that grid is ever rewritten, the escaping has to come
  with it, or an uploaded title becomes script running on your own site.
- No undo. A delete is a commit; recovering one means digging it out of git
  history.
