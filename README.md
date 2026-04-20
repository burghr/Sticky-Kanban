# Sticky Kanban

A self-hosted sticky-notes kanban board that works on desktop and iPad (with Apple Pencil drawing support).

Notes look like real stickies, drag between lanes, and support freehand pen input alongside text.

## Features

- **Multi-user**: local registration + login (bcrypt-hashed passwords, server-side sessions)
- **Multi-board**: each user can create, rename, and delete boards from a top-bar dropdown
- **Customizable lanes**: add, rename, reorder, delete
- **Sticky notes**: drag between lanes (long-press on touch), auto-rotated for the paper look
- **Text + drawing**: type, or switch to draw mode with pressure-aware pen/eraser (tuned for Apple Pencil)
- **Pen colors**: 9-color palette independent from the sticky paper color
- **Note metadata**: title, due date (with overdue highlighting), done checkbox, single category
- **Categories**: per-board, colored pill on cards, filterable from the top bar; new notes prefill the active filter
- **Appearance controls** (per-user, persisted):
  - UI theme: light / dark
  - Sticky theme: bright / muted (independent of UI theme, fixes contrast in dark mode)
  - Font: handwritten / standard
  - Lane width: standard / wide / extra wide
- **PWA**: install-to-home-screen on iPad with its own icon and splash
- **Admin panel** (`/admin`): list all users, see last-login, board/note counts, reset passwords, delete inactive accounts
- **Password self-service**: users can change their own password from the settings menu
- **Local-only data**: everything lives in SQLite inside a Docker volume. No external services.

## Run

```bash
cp .env.example .env
# edit .env — at minimum set SESSION_SECRET to a random value:
#   openssl rand -hex 32

docker compose up -d --build
```

Then open <http://localhost:9889> and register an account.

Data persists in `./data/sticky.db` (WAL mode).

## Environment variables

All are optional except as noted.

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_SECRET` | `dev-secret-change-me` | **Set this.** Signs session cookies. |
| `ADMIN_USERNAME` | *(unset)* | Promotes this username to admin on server start. The user must register first, then restart the container. |
| `PORT` | `9889` | HTTP port inside the container. Change the compose port mapping too if you edit this. |
| `DATA_DIR` | `/data` | Where `sticky.db` lives inside the container (mounted from `./data`). |

## Admin

1. Set `ADMIN_USERNAME=yourname` in `.env`.
2. Start the app and register that username normally.
3. Restart the container so the promotion takes effect:
   ```bash
   docker compose restart sticky-kanban
   ```
4. Sign in → **⚙ → Admin → Users…** to view the user list, reset passwords, and delete accounts.

Admins cannot delete themselves. Deleting a user cascades through boards, lanes, notes, and categories.

## Development notes

- `server.js` — Express app, SQLite via `better-sqlite3`, migrations applied at boot via `PRAGMA table_info`.
- `public/` — static frontend (`index.html`, `login.html`, `admin.html`, `app.js`, `auth.js`, `admin.js`, `styles.css`, PWA icons/manifest).
- No build step. Edit files, rebuild the image.
- Bcrypt is `bcryptjs` (pure JS) to keep the image slim; `better-sqlite3` is the only native dep.

## Stopping / rebooting

On host shutdown, prefer a clean stop so SQLite flushes cleanly:

```bash
docker compose stop
sudo reboot
```

`restart: unless-stopped` in the compose file brings the container back up automatically on boot.
