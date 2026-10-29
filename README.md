# Pumpkin Manor Escape (호박 저택 탈출)

A 3D Halloween hide-and-seek escape game for elementary classrooms. Alone or with up to 3 friends on their own devices, kids sneak past monsters, collect torn note pieces, rebuild a grade-level question and answer it to open the exit.

- **Play (English):** https://dew978.github.io/pumpkin-manor-escape/?lang=en
- **Play (Korean / 한국어):** https://dew978.github.io/pumpkin-manor-escape/?lang=ko
- Switch language any time with the 🌐 button on the title screen or in Settings.
- Built for Vibe Forge by 삼대710 (Samdae710).

## How to play

1. Press **Start**, choose a grade (1–6), then **Play alone** (or create a room and share the 5-letter code with friends).
2. Find the 4 pieces of the torn note hidden in furniture with a glowing **?**. Answer a short question to search each spot. The detector at the top gets hotter as you get close.
3. Put the pieces in order, read the full question and pick the answer. The exit door opens.
4. Avoid monsters: hide in wardrobes, throw candy to lure them away, use the crystal ball or speed potion.

| Key | Action |
|---|---|
| WASD / arrows (touch: drag on the left side) | Move |
| E / Space | Hide, open box, search, pick up |
| Q | Use item |
| Mouse click / F (touch: candy button) | Throw candy |
| Tab | Open the note |
| Esc | Pause (solo) |

Teachers: **Settings → Teacher: edit questions** replaces the questions with your own (JSON, any subject). **Settings → Monster speed** adjusts difficulty.

**Questions don't repeat:** box and furniture questions come from a shuffled deck on each device, with no repeats during a whole game (retrying a floor keeps drawing new ones), mixed with math questions generated with fresh numbers each time. Retrying a floor also swaps its note question.

**Co-op connection:** if a friend's connection drops, their screen stays in the game and reconnects to the same seat for up to a minute while the host holds the seat (📶). Note: PeerJS's public relay (TURN) server is currently not responding, so co-op needs devices that can reach each other directly; some school Wi-Fi networks block this.

## Tech

Static web app (no build step, no backend): three.js r160, ES modules, PeerJS (WebRTC) for co-op. The host device runs the game simulation (`game/src/sim.js`) and friends receive the state. English and Korean text live side by side in the code (`T(ko, en)` in `game/src/util.js`); English questions are in `game/src/questions_en.js`.

Run locally: in `game/`, run `npx http-server -p 8010 -c-1` and open http://localhost:8010.
Difficulty check: `node tools/kidbot.mjs` (a bot that plays like a young child).

Credits: 3D models from the Scenario 3D Collection (CC BY 4.0), three.js (MIT), PeerJS (MIT). See [game/assets/models/CREDITS.md](game/assets/models/CREDITS.md).

© 2026 Samdae710 (삼대710). Non-commercial classroom use only; no copying, modifying or commercial use.

---

# 호박 저택 탈출

할로윈 밤, 괴물을 피해 쪽지 문제를 풀고 저택을 빠져나가는 초등학생용 협동 술래잡기 게임. 한국어·영어를 고를 수 있다(타이틀 화면 🌐 단추 또는 설정).

- 플레이: https://dew978.github.io/pumpkin-manor-escape/
- 게임 설명·조작·선생님 안내: [game/README.md](game/README.md)
- 기획서: [game/기획서_호박저택탈출.md](game/기획서_호박저택탈출.md)

`main`에 올리면 GitHub Actions(`.github/workflows/pages.yml`)가 `game/` 폴더를 GitHub Pages로 배포한다.
로컬 실행: `game/`에서 `npx http-server -p 8010 -c-1`
