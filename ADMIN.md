# Managing portfolio work from the browser

Go to **`/admin`** and enter the password. From there you can:

- **Add** a work — pick an image, fill in title, description and category,
  and optionally attach a video
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
- **Repository access** → Only select repositories → the repo this site deploys
  from (`tazuuu/diagramadvertisement`)
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

Optional: `GITHUB_BRANCH` (defaults to `main`), and `GITHUB_REPO` (`owner/name`)
to commit somewhere other than the repo Vercel deployed from.

**Renaming the repo on GitHub is safe.** The endpoint reads the repo name from
Vercel's own deployment info, so it corrects itself on the next deploy, and the
token follows the rename because fine-grained tokens are bound to the repo's ID
rather than its name. Only set `GITHUB_REPO` if you want to override that — and
if you do, remember to update it after a rename, or uploads will fail.

Redeploy once after adding them — environment variables are read at deploy time.

## Video (optional)

Until the variables below are set, the video field simply does not appear and
everything else works as it always has.

Videos do not go in this repo. A phone clip is tens of megabytes; this endpoint
rejects anything over 4.5MB, and a repo never forgets a file you put in it. So
the browser uploads the video straight to **Cloudflare R2** and only the
resulting URL is committed. R2 charges nothing for downloads at any volume,
which is the reason to prefer it over the alternatives.

**Before you start:** R2's free allowance is 10GB of storage, but Cloudflare
still asks for a card on file to switch R2 on. Nothing is charged while you stay
under the allowance — roughly 200 clips at 50MB — but the card is not optional.
If that is a problem, skip this section; the site works without it.

### 1. Make the bucket

<https://dash.cloudflare.com> → **R2** → **Create bucket**. Any name; this guide
assumes `diagram-media`.

Then, on the bucket:

- **Settings → Public access** → enable the **r2.dev subdomain**. Cloudflare
  gives you a URL like `https://pub-1a2b….r2.dev` and rate-limits it, which is
  fine at this size. Connecting a custom domain removes that limit, but needs
  the domain's DNS on Cloudflare — worth doing later, not now.
- **Settings → CORS policy** → **Add**. Without this the browser refuses the
  upload, and the console will say so:

```json
[
  {
    "AllowedOrigins": [
      "https://diagramadvertisement.com",
      "https://www.diagramadvertisement.com"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

### 2. Make an R2 token

R2 → **Manage R2 API Tokens** → **Create API token**:

- **Permissions** → **Object Read & Write**
- **Specify bucket** → only `diagram-media`
- Nothing else

The **Secret Access Key** is shown once. Paste it into Vercel and nowhere else,
same rule as the GitHub token. This one is narrower than that one — it can write
objects into a single media bucket and touch nothing else.

### 3. Five more variables in Vercel

| Name | Value |
|------|-------|
| `R2_ACCOUNT_ID` | The ID in the dashboard URL, `dash.cloudflare.com/<this part>` |
| `R2_ACCESS_KEY_ID` | From step 2 |
| `R2_SECRET_ACCESS_KEY` | From step 2, the one shown once |
| `R2_BUCKET` | `diagram-media` |
| `R2_PUBLIC_BASE` | The `https://pub-….r2.dev` URL, no trailing slash |

Redeploy. The video field appears the next time you unlock `/admin`.

### Using it

Pick an image as usual — it stays the card thumbnail and the poster frame —
then pick a video. It uploads when you press Publish, with a progress bar,
because it goes to Cloudflare rather than through this site. On the portfolio a
video work gets a play badge, and opening it plays inline instead of showing a
still.

Deleting a work deletes its video from R2 too, and replacing a video deletes the
one it replaced.

The 200MB limit is the console's, not R2's. If something is bigger than that it
is bigger than anyone will wait for, so shrink it first:

```
ffmpeg -i clip.mov -vf scale=-2:1080 -c:v libx264 -crf 26 -preset slow clip.mp4
```

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
| *Could not reach the video host* | The bucket has no CORS rule, or it does not list the domain you are on. |
| *The video upload was rejected (403)* | R2 token revoked, lacking Object Write, or scoped to a different bucket. |
| *Video storage is not configured* | One of the five `R2_` variables is missing. All five or none. |
| *That video is not on the media host…* | `R2_PUBLIC_BASE` changed after a video was uploaded. Old URLs no longer match it. |
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
  history. A deleted video is gone from R2 outright, which git cannot help with.
- **Videos are public to anyone with the URL.** The bucket serves them without
  authentication, exactly like the images. Do not upload a client's unreleased
  work expecting the URL to stay private.
- Changing `R2_PUBLIC_BASE` — moving from the r2.dev URL to a custom domain,
  say — orphans every video already published. The files stay in the bucket, but
  the stored URLs still point at the old host and the endpoint will refuse to
  edit those works until the URLs are updated.
