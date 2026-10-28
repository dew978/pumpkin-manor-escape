// 넘기는 컷 만화: 그림 아래 큰 대사창에 한 줄씩 띄우고(말하는 사람 얼굴과 이름), 누르면(탭·클릭·Enter·Space) 다음으로 넘어간다.
// 그림은 assets/comic/<id>.jpg (art/comic/panels에서 줄여 만든다). 그림 속에는 글자가 없고 대사는 여기서 얹는다.
import { esc, T } from './util.js';
import { Sound } from './audio.js';

const WHO = {
  '마녀': '#b07cff', '흡혈귀': '#ff5a6b', '호박': '#ff9a3a', '미라': '#7fe0c8', '루미': '#9fe6ff', '모두': '#ffd27a', '': '#efe3c8',
};
// 대사창 얼굴(게임 속 대사창과 같은 그림). '모두'는 네 아이 얼굴을 함께, 해설('')은 얼굴 없이
const FACE = { '마녀': 'witch', '흡혈귀': 'vampire', '호박': 'pumpkin', '미라': 'mummy', '루미': 'lumi' };
// 화면에 보이는 이름(영어판)
const NAME = T({}, { '마녀': 'Witch', '흡혈귀': 'Vampire', '호박': 'Pumpkin', '미라': 'Mummy', '루미': 'Lumi', '모두': 'Everyone' });
const faceHTML = (who) => who === '모두'
  ? `<div class="face group">${['witch', 'vampire', 'pumpkin', 'mummy'].map(f => `<img src="assets/faces/${f}.jpg" alt="">`).join('')}</div>`
  : FACE[who] ? `<img class="face" src="assets/faces/${FACE[who]}.jpg" alt="" style="border-color:${WHO[who]}">` : '';

export const COMIC = {
  intro: [
    { img: 'p01', lines: [['마녀', T('학교 할로윈 축제다! 6학년 언니 오빠들이 귀신의 집을 만들었대.', "It's the school Halloween fair! The 6th graders made a haunted house.")], ['흡혈귀', T('골판지로 만든 거잖아. 하나도 안 무서울걸?', "It's just cardboard. It won't be scary at all.")]] },
    { img: 'p02', lines: [['호박', T('어? 맨 끝에 이런 문이 있었나?', 'Huh? Was this door here at the end?')], ['미라', T('이건 진짜 나무문이야… 열어 볼까?', 'This is a real wooden door… Should we open it?')]] },
    { img: 'p03', lines: [['', T('휘이이잉—!', 'Whoooosh—!')], ['모두', T('으아아악!', 'Aaaaah!')]] },
    { img: 'p04', lines: [['루미', T('너희도 갇혔구나. 나는 루미야.', "So you're trapped too. I'm Lumi.")], ['루미', T('이 집 주인이 수수께끼 쪽지를 네 조각으로 찢어서 저택 곳곳에 숨겼어.', 'The owner of this house tore a riddle note into four pieces and hid them all over the manor.')], ['루미', T('조각을 순서대로 맞춰 문제를 풀고, 정답을 저 문에 넣어야 열려.', 'Put the pieces in order, solve the question, and give the answer to that door to open it.')]] },
    { img: 'p05', lines: [['루미', T('조심해. 자정 종이 울리면… 너희도 영원히 이 집 유령이 돼.', 'Be careful. When the midnight bell rings… you become ghosts of this house forever.')]] },
    { img: 'p06', lines: [['루미', T('괴물들이 쪽지를 지키고 있어. 잡히면 쪽지를 빼앗기고 새장에 갇혀.', 'Monsters guard the notes. If they catch you, they take a piece and lock you in a cage.')], ['루미', T('들키면 옷장에 숨어! 갇힌 친구는 새장 옆에 서 있으면 구할 수 있어.', 'If they spot you, hide in a wardrobe! Stand next to a cage to free a friend.')]] },
    { img: 'p07', lines: [['루미', T('자, 손전등이야. 행운을 빌어… 히히.', "Here's a flashlight. Good luck… hee hee.")], ['모두', T('가자!', "Let's go!")]] },
  ],
  after1: [
    { img: 'p08', lines: [['루미', T('문이 하나 더 있어. 지하 서고로 내려가야 해.', "There's another door. We have to go down to the underground library.")]] },
    { img: 'p09', lines: [['흡혈귀', T('저택 주인 초상화인데… 얼굴이 찢겨 있어.', "It's a portrait of the owner… but the face is torn.")], ['미라', T('저 주황 리본… 어디서 봤더라?', "That orange ribbon… where have I seen it?")]] },
  ],
  after2: [
    { img: 'p10', lines: [['호박', T('얘들아, 책상 위에 오래된 사진이 있어!', "Everyone, there's an old photo on the desk!")]] },
    { img: 'p11', lines: [['마녀', T('이 아이… 루미랑 똑같이 생겼어.', 'This kid… looks exactly like Lumi.')], ['', T('저 멀리 정원 쪽에서 문이 삐걱 열리는 소리가 들렸다.', 'Far away, near the garden, a door creaked open.'), 'creak']] },
  ],
  // 새 층 사이(지하 서고 → 지하 창고, 지하 창고 → 저택 2층, 호박밭 → 묘지 정원)
  cellar2: [
    { img: 'p16', lines: [['미라', T('책을 하나 당겼더니… 책장이 문처럼 열렸어!', 'I pulled a book… and the bookshelf opened like a door!')], ['호박', T('아래로 계단이 또 있어. 더 깊이 내려가야 하나 봐.', 'More stairs going down. I guess we go deeper.')], ['루미', T('이 아래는 창고야. 나무통 사이에 쪽지가 또 숨어 있을 거야.', "The cellar is down there. More note pieces are hiding between the barrels.")]] },
  ],
  upstairs: [
    { img: 'p17', lines: [['흡혈귀', T('열쇠 방에서 찾았어. 주황 리본이 달린 열쇠야!', 'Found it in the key room. A key with an orange ribbon!')], ['미라', T('주황 리본… 루미 리본이랑 똑같은데?', "An orange ribbon… just like Lumi's?")], ['루미', T('어, 어서 2층으로 올라가자! 계단은 저쪽이야.', "Uh, let's hurry up to the second floor! The stairs are over there.")]] },
  ],
  gate: [
    { img: 'p18', lines: [['호박', T('저기 묘지 정원 문이 보여!', 'I can see the graveyard garden gate!')], ['루미', T('…자정이 얼마 안 남았어. 이번이 마지막이야.', "…It's almost midnight. This is the last one.")], ['', T('멀리서 종소리가 한 번 울렸다.', 'Far away, a bell rang once.'), 'bell']] },
  ],
  ending: [
    { img: 'p12', lines: [['루미', T('사실… 쪽지를 찢은 건 나야.', 'Actually… I was the one who tore the notes.')], ['루미', T('내가 이 집 주인이거든.', "Because I'm the owner of this house.")]] },
    { img: 'p13', lines: [['루미', T('백 년 동안 할로윈마다 혼자였어. 같이 놀 친구가 필요했어.', 'For a hundred years I was alone every Halloween. I needed friends to play with.')], ['루미', T('너희랑 술래잡기한 거, 정말 재밌었어. 고마워.', 'Playing tag with you was so much fun. Thank you.')]] },
    { img: 'p14', lines: [['', T('정신을 차려 보니 학교 강당의 귀신의 집이었다.', 'When they woke up, they were back in the haunted house in the school hall.')], ['흡혈귀', T('꿈…이었나?', 'Was it… a dream?')]] },
    { img: 'p15', lines: [['마녀', T('얘들아, 내 주머니에 이게 들어 있어.', 'Everyone, this was in my pocket.')], ['', T('"내년 할로윈에도 같이 놀자. — 루미"', '"Let\'s play again next Halloween. — Lumi"')]] },
  ],
};

// 지금 보이는 만화 닫기(방장이 다음 층을 시작하면 친구 화면의 만화를 닫는다)
let closeCurrent = null;
export function closeComic() { closeCurrent?.(); }
export const comicOpen = () => !!closeCurrent;

// 만화 보여 주기. 끝나거나 건너뛰면 resolve
export function playComic(key) {
  const pages = COMIC[key]; if (!pages) return Promise.resolve();
  return new Promise(resolve => {
    const box = document.createElement('section'); box.className = 'comic'; box.setAttribute('aria-label', T('만화', 'Comic'));
    box.innerHTML = `<div class="comic-frame"><img class="comic-img" alt=""></div>
      <div class="comic-say"></div>
      <div class="comic-bar"><span class="comic-page"></span><span class="comic-hint">${T('눌러서 넘기기', 'Tap to continue')}</span><button class="comic-skip">${T('건너뛰기 ▶▶', 'Skip ▶▶')}</button></div>`;
    document.getElementById('app').appendChild(box);
    const img = box.querySelector('.comic-img'), say = box.querySelector('.comic-say'), page = box.querySelector('.comic-page');
    let p = 0, l = 0, done = false;
    // 다음 그림을 미리 받아 둔다
    pages.forEach(pg => { const i = new Image(); i.src = `assets/comic/${pg.img}.jpg`; });
    const finish = () => { if (done) return; done = true; if (closeCurrent === finish) closeCurrent = null; removeEventListener('keydown', onKey, true); box.classList.add('out'); setTimeout(() => box.remove(), 300); resolve(); };
    const show = () => {
      const pg = pages[p];
      if (l === 0) { img.src = `assets/comic/${pg.img}.jpg`; img.classList.remove('in'); void img.offsetWidth; img.classList.add('in'); }
      const [who, text, sfx] = pg.lines[l];
      if (sfx) Sound.play(sfx, 1);   // 세 번째 칸: 이 대사가 뜰 때 나는 효과음
      say.className = `comic-say ${who ? 'talk' : 'narr'}`;
      say.innerHTML = faceHTML(who) + `<div class="say"><b class="who" style="color:${WHO[who] || '#fff'}">${esc(NAME[who] ?? who)}</b><p class="line">${esc(text)}</p></div><span class="next">▶</span>`;
      say.classList.remove('in'); void say.offsetWidth; say.classList.add('in');
      page.textContent = `${p + 1} / ${pages.length}`;
    };
    const next = () => {
      if (done) return;
      l++;
      if (l >= pages[p].lines.length) { l = 0; p++; }
      if (p >= pages.length) finish(); else show();
    };
    const onKey = (e) => {
      if (['Space', 'Enter', 'NumpadEnter', 'ArrowRight', 'KeyE'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); next(); }
      else if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
    };
    box.addEventListener('pointerup', (e) => { if (!e.target.closest('.comic-skip')) next(); });
    box.querySelector('.comic-skip').onclick = finish;
    addEventListener('keydown', onKey, true);
    closeCurrent?.(); closeCurrent = finish;
    show();
  });
}
