// 쪽지를 주울 때 화면 아래에 뜨는 대사창. 주운 아이가 쪽지 글을 읽고, 루미가 이야기를 잇는다.
// 게임은 멈추지 않는다(괴물은 계속 움직인다). 누르면 다음 대사로 넘어간다.

// 루미 대사: 층마다 조각 1~4번째. 1층은 조작 안내, 지하는 복선, 정원은 반전 예고
const LUMI = [
  [
    '그 쪽지, 이 저택 주인이 남긴 수수께끼야. 네 조각을 다 모으면 문제가 돼!',
    '괴물이 쫓아오면 사탕을 던져 봐. 괴물들은 사탕이라면 정신을 못 차리거든!',
    '복도 끝 초상화가 너희를 보는 것 같지 않아? …아, 아무것도 아니야!',
    '이제 쪽지 단추를 눌러 봐. 가장자리 색이 같은 조각끼리 끌어다 붙이면 돼!',
  ],
  [
    '여기 책들은 백 년 전 그대로야. 나도 여기서 책 읽는 걸 좋아했… 아니, 그냥 그렇다고!',
    '해골 기사는 귀가 밝아. 쫓기면 옷장에 숨어 봐.',
    '책장 사이 거미 조심해! 가까이 가면 갑자기 튀어나와.',
    '다 모았구나! 문제를 풀면 정원으로 나가는 계단이 열릴 거야.',
  ],
  [
    '마지막 정원이야. 자정 종이 울리기 전에 나가야 해!',
    '까마귀 박사는 멀리까지 봐. 비석 뒤로 살금살금 다녀.',
    '그런데… 이 쪽지를 누가 찢었는지 궁금하지 않아? 나가면 알려 줄게.',
    '이게 마지막 문제야. 너희라면 꼭 풀 수 있어!',
  ],
];

// 아이 대사: 주운 쪽지 글을 그대로 읽는다(문제 내용과 이어지게)
const KID = [
  (t) => `찾았다! 찢어진 쪽지에 "${t}"라고 쓰여 있어.`,
  (t) => `하나 더! 이번엔 "${t}"… 앞 조각이랑 이어질 것 같아.`,
  (t) => `"${t}" — 세 번째 조각이야. 하나만 더 찾으면 돼!`,
  (t) => `마지막 조각! "${t}". 이제 이어 붙여 보자!`,
];

export const LUMI_FACE = 'assets/faces/lumi.jpg';

export function fragLines(stageIdx, n, part, kid, hint) {
  const k = Math.max(1, Math.min(4, n)) - 1;
  const lines = [
    { face: kid.face, name: kid.name, color: kid.color, text: KID[k](part) },
    { face: LUMI_FACE, name: '루미', color: '#9fd8ff', text: LUMI[stageIdx % LUMI.length][k] },
  ];
  if (hint) lines.push(lumiLine(hint));
  return lines;
}
export const lumiLine = (text) => ({ face: LUMI_FACE, name: '루미', color: '#9fd8ff', text });

// 대사창: 한 줄씩 글자가 찍히고, 다 읽을 시간이 지나면(또는 누르면) 다음 줄
const queue = [];
let box = null, timer = 0, typing = 0;
function ensureBox() {
  if (box) return box;
  box = document.createElement('div');
  box.id = 'dialog'; box.hidden = true; box.setAttribute('aria-live', 'polite');
  box.innerHTML = '<img class="face" alt=""><div class="say"><b class="who"></b><p class="line"></p></div><span class="next">▶</span>';
  box.addEventListener('pointerdown', (e) => { e.stopPropagation(); next(); });
  document.getElementById('app').appendChild(box);
  return box;
}
function show(l) {
  const b = ensureBox();
  b.querySelector('.face').src = l.face; b.querySelector('.face').style.borderColor = l.color;
  const who = b.querySelector('.who'); who.textContent = l.name; who.style.color = l.color;
  const line = b.querySelector('.line'); line.textContent = '';
  b.hidden = false; b.classList.remove('in'); void b.offsetWidth; b.classList.add('in');
  // 글자를 한 자씩(초등학생이 따라 읽기 좋게 조금 천천히)
  let i = 0; clearInterval(typing);
  typing = setInterval(() => { i++; line.textContent = l.text.slice(0, i); if (i >= l.text.length) clearInterval(typing); }, 28);
  clearTimeout(timer); timer = setTimeout(next, 2200 + l.text.length * 75);
}
function next() {
  clearTimeout(timer); clearInterval(typing);
  const l = queue.shift();
  if (l) show(l); else if (box) box.hidden = true;
}
export function say(lines) {
  const idle = !box || box.hidden;
  queue.push(...lines);
  if (idle) next();
}
export function clearDialog() { queue.length = 0; clearTimeout(timer); clearInterval(typing); if (box) box.hidden = true; }
export const dialogOpen = () => !!box && !box.hidden;
