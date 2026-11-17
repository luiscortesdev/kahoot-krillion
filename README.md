# 🦐 Krillion

Kahoot-style classroom game: the rarest answer, given fastest, sinks your krill deepest. Deepest krill wins.

## Run
```
npm install
npm start
```
- Teacher: open `http://localhost:3000/host` on the projector, edit questions, click **Create game**.
- Students: go to the address shown on screen (same Wi-Fi), enter the PIN + nickname.
- Wrong IP shown? Run with `HOST_IP=your.ip npm start`.

## Scoring
- Accepted answers list (comma separated) — blank means any answer counts. Case, spaces and plurals are ignored.
- Depth gain = 50 + 950 × (1 / players who gave the same answer) × speed (100% instantly → 50% at the buzzer).
- Wrong or no answer = 0m.
