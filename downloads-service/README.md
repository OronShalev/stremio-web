# Stremio downloads service

A small local helper (plain Node.js, no dependencies) that powers the **Download** button on torrent streams and the **Downloads** tab of stremio-web.

```
stremio-web (browser)  ──HTTP──▶  downloads service (127.0.0.1:11471)  ──Web API──▶  qBittorrent (localhost:8090)
                                         │
                                         └── reads / deletes files in the downloads folder
```

The browser can't talk to qBittorrent directly (CORS / CSRF protection) and can't touch the file system, so this service does both.

## Running it

1. In qBittorrent: **Tools → Options → Web UI** → enable the Web UI on port `8090`.
   Either tick **"Bypass authentication for clients on localhost"** or put your Web UI username/password in `config.json` (see below).
2. From the `stremio-web` folder:

   ```
   pnpm downloads-service
   ```

   or double-click `downloads-service\start.cmd` on Windows.
3. Start stremio-web as usual (`pnpm start`). A download icon now appears next to the play icon on every torrent stream, and a **Downloads** tab is in the left menu.

## Where files go

Default folder: `%USERPROFILE%\AppData\Stremio\downloads`

```
downloads\
  series\<Show name>\Season 01\Episode 03\<infoHash>\...
  movies\<Movie name>\<infoHash>\...
```

Each torrent folder contains a `stremio-download.json` describing what it is (title, poster, season/episode, which file of the torrent was requested). The Downloads tab is built by scanning the folder for these files, so:

* deleting a folder by hand removes it from the Downloads tab,
* deleting from the Downloads tab removes the torrent from qBittorrent **and** the files from disk (empty parent folders are cleaned up),
* downloads survive restarts of qBittorrent, Stremio or this service. If a torrent was removed from qBittorrent but files are still there, finished files can still be watched and unfinished ones can be resumed (the torrent is re-added and qBittorrent re-checks the existing data).

Only the file Stremio would play is downloaded. For season packs, the other files are set to "do not download" in qBittorrent. Downloading another episode from the same pack reuses the same torrent and folder.

## Running everything with Docker

`docker-compose.yml` in the repo root runs the whole stack: the web UI, the Stremio streaming server, this service and qBittorrent.

```
cp .env.example .env          # set DOWNLOADS_HOST_DIR (your downloads folder)
docker compose up -d --build
```

Then open **http://localhost:8080**. Stop the locally installed Stremio Service and qBittorrent first, because the containers use the same ports.

| Service            | Image                                  | Port(s) on your computer         |
|--------------------|----------------------------------------|----------------------------------|
| `web`              | built from this repo                   | `8080`                           |
| `stremio-server`   | `stremio/server`                       | `11470`, `12470`                 |
| `downloads-service`| built from `downloads-service/`        | `11471`                          |
| `qbittorrent`      | `lscr.io/linuxserver/qbittorrent`      | `8090` (Web UI), `6881` (peers)  |

Notes:

* qBittorrent and this service both mount `DOWNLOADS_HOST_DIR` at `/downloads`, so the save paths match.
* On its first start, qBittorrent gets `docker/qbittorrent/qBittorrent.conf`. This sets the Web UI to port 8090, saves to `/downloads`, turns off queueing, and skips the login for the compose network. To start over, run `docker compose down -v`, which also deletes the qBittorrent settings and the streaming server cache.
* The streaming server runs with `NO_CORS=1`, so the web UI can talk to it with no CORS errors in the console.
* The downloads service shares the streaming server's network. Downloaded files are played from `http://127.0.0.1:11471`, and the streaming server can fetch the same address when it needs to transcode.
* **Show in folder** isn't available in Docker, because a container can't open Explorer. Instead the button shows where the file is on your computer.
* All ports except the torrent port 6881 are published on `127.0.0.1` only.

## Configuration

Set environment variables, or copy `config.example.json` to `config.json` and edit it:

| config.json key        | environment variable     | default                                  |
|------------------------|--------------------------|------------------------------------------|
| `port`                 | `DOWNLOADS_SERVICE_PORT` | `11471`                                  |
| `host`                 | `DOWNLOADS_SERVICE_HOST` | `127.0.0.1`                              |
| `downloadsDir`         | `DOWNLOADS_DIR`          | `<home>/AppData/Stremio/downloads`       |
| `qbittorrentUrl`       | `QBITTORRENT_URL`        | `http://localhost:8090`                  |
| `qbittorrentUsername`  | `QBITTORRENT_USERNAME`   | *(empty – relies on localhost bypass)*   |
| `qbittorrentPassword`  | `QBITTORRENT_PASSWORD`   | *(empty)*                                |
| `downloadsHostDir`     | `DOWNLOADS_HOST_DIR`     | *(Docker only: the folder on the host)*  |
| `allowedOrigins`       | `ALLOWED_ORIGINS`        | any `localhost` / `127.0.0.1` origin     |

If you change the port, tell the web UI where to find the service (browser dev tools console):

```js
localStorage.setItem('downloadsServiceUrl', 'http://127.0.0.1:12345')
```

If you open stremio-web from a host other than localhost (e.g. `https://web.stremio.com` or your LAN IP), add that origin to `allowedOrigins`.

## API

| Method & path                         | Description                                   |
|---------------------------------------|-----------------------------------------------|
| `GET /api/health`                     | service + qBittorrent status                  |
| `GET /api/downloads`                  | all downloads (disk + live qBittorrent stats) |
| `POST /api/downloads`                 | start a download                              |
| `POST /api/downloads/:id/pause`       | pause                                         |
| `POST /api/downloads/:id/resume`      | resume (re-adds the torrent if needed)        |
| `POST /api/downloads/:id/reveal`      | open the file in Explorer / Finder            |
| `DELETE /api/downloads/:id`           | remove torrent and delete the files           |
| `GET /stream/:id/:fileName`           | the video file (supports HTTP Range)          |
