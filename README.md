# gladys-dingz

Unofficial [Gladys Assistant](https://gladysassistant.com) external integration
for the [dingz](https://www.dingz.ch) smart switches (iolo AG), over their local
REST API — no cloud.

- Discovery: UDP announcements (port 7979, mediated by the Gladys core) and/or
  addresses entered by hand.
- One Gladys device per dingz: lights and dimmers, other outputs as switches,
  blinds (open/close/stop, position, slats), temperature, light level, motion,
  power per output.
- States read every `refresh_interval` seconds (5 by default), only the
  changed values published; fast follow-up reads after a command, until a
  blind stops.

User documentation: [docs/fr.md](docs/fr.md) · [docs/en.md](docs/en.md).

## Layout

```
index.js            SDK wiring
src/app.js          runtime: address book, scan, refresh loop, commands, actions
src/client.js       dingz REST client (per-host serialized queue, retries)
src/model.js        pure mapping dingz <-> Gladys (layout, features, states, commands)
src/store.js        MAC -> address book persisted in /data/hosts.json
src/config.js       defaults (mirror of the manifest) + normalization
test/               node --test against the SDK's fake Gladys, no network
```

## Develop

```bash
npm install
npm test
npm run lint && npm run format:check
npx github:GladysAssistant/integration-store .   # store admission checks
```

## Publish

1. Push this repository to GitHub as `gladys-dingz` (public) and add the topic
   `gladys-assistant-integration`.
2. If your GitHub user is not `bezenconv`, replace it in
   `gladys-assistant-integration.json` (`docker_image`, `cover_image`, doc links).
3. **Actions → Release → Run workflow → `minor`**: builds the multi-arch image
   `ghcr.io/<you>/gladys-dingz:0.1.0`, tags `v0.1.0` and creates the GitHub Release.
4. In GitHub → Packages → `gladys-dingz` → settings, make the package **public**.
5. In Gladys: **Integrations → Install from GitHub**, paste the repository URL.

## License

Apache-2.0. Not affiliated with iolo AG.
