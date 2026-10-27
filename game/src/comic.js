// 넘기는 컷 만화: 그림 아래 큰 대사창에 한 줄씩 띄우고(말하는 사람 얼굴과 이름), 누르면(탭·클릭·Enter·Space) 다음으로 넘어간다.
// 그림은 assets/comic/<id>.jpg (art/comic/panels에서 줄여 만든다). 그림 속에는 글자가 없고 대사는 여기서 얹는다.
import { esc } from './util.js';
import { Sound } from './audio.js';

const WHO = {
  '마녀': '#b07cff', '흡혈귀': '#ff5a6b', '호박': '#ff9a3a', '미라': '#7fe0c8', '루미': '#9fe6ff', '모두': '#ffd27a', '': '#efe3c8',
};
// 대사창 얼굴(게임 속 대사창과 같은 그림). '모두'는 네 아이 얼굴을 함께, 해설('')은 얼굴 없이
const FACE = { '마녀': 'witch', '흡혈귀': 'vampire', '호박': 'pumpkin', '미라': 'mummy', '루미': 'lumi' };
const faceHTML = (who) => who === '모두'
  ? `<div class="face group">${['witch', 'vampire', 'pumpkin', 'mummy'].map(f => `<img src="assets/faces/${f}.jpg" alt="">`).join('')}</div>`
  : FACE[who] ? `<img class="face" src="assets/faces/${FACE[who]}.jpg" alt="" style="border-color:${WHO[who]}">` : '';

export const COMIC = {
  intro: [
    { img: 'p01', lines: [['마녀', '학교 할로윈 축제다! 6학년 언니 오빠들이 귀신의 집을 만들었대.'], ['흡혈귀', '골판지로 만든 거잖아. 하나도 안 무서울걸?']] },
    { img: 'p02', lines: [['호박', '어? 맨 끝에 이런 문이 있었나?'], ['미라', '이건 진짜 나무문이야… 열어 볼까?']] },
    { img: 'p03', lines: [['', '휘이이잉—!'], ['모두', '으아아악!']] },
    { img: 'p04', lines: [['루미', '너희도 갇혔구나. 나는 루미야.'], ['루미', '이 집 주인이 수수께끼 쪽지를 네 조각으로 찢어서 저택 곳곳에 숨겼어.'], ['루미', '조각을 순서대로 맞춰 문제를 풀고, 정답을 저 문에 넣어야 열려.']] },
    { img: 'p05', lines: [['루미', '조심해. 자정 종이 울리면… 너희도 영원히 이 집 유령이 돼.']] },
    { img: 'p06', lines: [['루미', '괴물들이 쪽지를 지키고 있어. 잡히면 쪽지를 빼앗기고 새장에 갇혀.'], ['루미', '들키면 옷장에 숨어! 갇힌 친구는 새장 옆에 서 있으면 구할 수 있어.']] },
    { img: 'p07', lines: [['루미', '자, 손전등이야. 행운을 빌어… 히히.'], ['모두', '가자!']] },
  ],
  after1: [
    { img: 'p08', lines: [['루미', '문이 하나 더 있어. 지하 서고로 내려가야 해.']] },
    { img: 'p09', lines: [['흡혈귀', '저택 주인 초상화인데… 얼굴이 찢겨 있어.'], ['미라', '저 주황 리본… 어디서 봤더라?']] },
  ],
  after2: [
    { img: 'p10', lines: [['호박', '얘들아, 책상 위에 오래된 사진이 있어!']] },
    { img: 'p11', lines: [['마녀', '이 아이… 루미랑 똑같이 생겼어.'], ['', '저 멀리 정원 쪽에서 문이 삐걱 열리는 소리가 들렸다.', 'creak']] },
  ],
  ending: [
    { img: 'p12', lines: [['루미', '사실… 쪽지를 찢은 건 나야.'], ['루미', '내가 이 집 주인이거든.']] },
    { img: 'p13', lines: [['루미', '백 년 동안 할로윈마다 혼자였어. 같이 놀 친구가 필요했어.'], ['루미', '너희랑 술래잡기한 거, 정말 재밌었어. 고마워.']] },
    { img: 'p14', lines: [['', '정신을 차려 보니 학교 강당의 귀신의 집이었다.'], ['흡혈귀', '꿈…이었나?']] },
    { img: 'p15', lines: [['마녀', '얘들아, 내 주머니에 이게 들어 있어.'], ['', '"내년 할로윈에도 같이 놀자. — 루미"']] },
  ],
};

// 만화 보여 주기. 끝나거나 건너뛰면 resolve
export function playComic(key) {
  const pages = COMIC[key]; if (!pages) return Promise.resolve();
  return new Promise(resolve => {
    const box = document.createElement('section'); box.className = 'comic'; box.setAttribute('aria-label', '만화');
    box.innerHTML = `<div class="comic-frame"><img class="comic-img" alt=""></div>
      <div class="comic-say"></div>
      <div class="comic-bar"><span class="comic-page"></span><span class="comic-hint">눌러서 넘기기</span><button class="comic-skip">건너뛰기 ▶▶</button></div>`;
    document.getElementById('app').appendChild(box);
    const img = box.querySelector('.comic-img'), say = box.querySelector('.comic-say'), page = box.querySelector('.comic-page');
    let p = 0, l = 0, done = false;
    // 다음 그림을 미리 받아 둔다
    pages.forEach(pg => { const i = new Image(); i.src = `assets/comic/${pg.img}.jpg`; });
    const finish = () => { if (done) return; done = true; removeEventListener('keydown', onKey, true); box.classList.add('out'); setTimeout(() => box.remove(), 300); resolve(); };
    const show = () => {
      const pg = pages[p];
      if (l === 0) { img.src = `assets/comic/${pg.img}.jpg`; img.classList.remove('in'); void img.offsetWidth; img.classList.add('in'); }
      const [who, text, sfx] = pg.lines[l];
      if (sfx) Sound.play(sfx, 1);   // 세 번째 칸: 이 대사가 뜰 때 나는 효과음
      say.className = `comic-say ${who ? 'talk' : 'narr'}`;
      say.innerHTML = faceHTML(who) + `<div class="say"><b class="who" style="color:${WHO[who] || '#fff'}">${esc(who)}</b><p class="line">${esc(text)}</p></div><span class="next">▶</span>`;
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
    show();
  });
}
