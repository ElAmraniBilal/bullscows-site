# Bulls & Cows Arena

A live, room-code Bulls & Cows game. The static site stays on GitHub Pages; a small Node.js service manages rooms, shared secrets, guesses, timers, and live updates.

## Website

The GitHub Pages site is served from the repository root. `CNAME` remains `bullscows.xyz`, and `config.js` directs production browsers to `https://api.bullscows.xyz`.

## Game service

Requires Node.js 20 or newer. There are no package dependencies.

```sh
node server.js
```

Open `http://localhost:3000` to use the interface and API together. A hosting provider can run the same service with `PORT` set by the platform. The backend needs a custom hostname at `api.bullscows.xyz` with HTTPS enabled.

Set `ALLOWED_ORIGINS` on the game service if you use additional site origins. The default list allows `https://bullscows.xyz` and `https://www.bullscows.xyz` plus localhost for development.

## Render preview

`render.yaml` defines a free Node web service for the live room API. To create it, connect this repository to Render and deploy the Blueprint. In the service settings, add `api.bullscows.xyz` as a custom domain, then copy Render's DNS target into a `CNAME` record named `api` at the domain's DNS provider. The service is configured to accept browser requests from the apex and `www` domains.

Keep the existing apex and `www` records for GitHub Pages. The public DNS currently delegates to `topdns.com` nameservers. After the API hostname has HTTPS, deploy the root frontend files to GitHub Pages; `config.js` already directs production browsers to the API subdomain.

Render's free web services spin down after 15 minutes without inbound traffic and are intended for previews. A restart clears in-memory rooms, so use this service for a trial and move to always-on hosting before relying on it for public games. See [Render's free plan limits](https://render.com/docs/free).

## Match rules

- The shared secret has four different digits; leading zero is allowed.
- A bull means right digit and position. A cow means the digit is present in another position.
- Full rooms start automatically. The host can also start early once at least two players have joined.
- A solved player is locked in while the other players keep guessing. Solved players rank by fewest guesses, then fastest solve time.
- The secret stays on the server and is revealed when the match ends.

## Current limits

Room state is stored in memory, so a service restart clears active rooms. Run one backend instance; multiple instances need shared storage. This version does not include player accounts, persistent ratings, public matchmaking, or room recovery.
