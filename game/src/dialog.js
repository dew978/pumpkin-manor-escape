// 쪽지를 주울 때 화면 아래에 뜨는 대사창. 주운 아이가 쪽지 글을 읽고, 루미가 이야기를 잇는다.
// 게임은 멈추지 않는다(괴물은 계속 움직인다). 누르면 다음 대사로 넘어간다.

import { T } from './util.js';

// 루미 대사: 층마다 첫 쪽지의 조각 1~4번째. 1층은 조작 안내, 지하·2층은 복선, 정원은 반전 예고
const LUMI_KO = [
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
    '다 모았구나! 문제를 풀면 더 깊은 창고로 내려가는 문이 열릴 거야.',
  ],
  [
    '나무통 속에 쪽지가 있었구나! 여긴 백 년 묵은 호박잼 냄새가 나.',
    '거미가 둥지를 지키고 있어. 멈칫하면 옆으로 피해!',
    '열쇠 방… 거기엔 들어가 본 적이 있는 것 같아. 이상하다.',
    '다 모았어! 이어 붙여서 문제를 풀어 봐.',
  ],
  [
    '이 침대… 나 여기서 잔 적이 있는 것 같아. 기분 탓이겠지?',
    '인형 방 인형들이 너희를 쳐다보지? 괜찮아, 걔네는 착해.',
    '박쥐 악마가 소리치면 저승사자가 몰려와! 옷장을 잘 써.',
    '다 모았네! 쪽지를 이어 붙여 봐.',
  ],
  [
    '호박 덩굴 사이에서 찾았구나! 옛날에 여기 호박으로 잭오랜턴을 만들었어.',
    '허수아비는 그냥 허수아비야… 아마도.',
    '까마귀 박사는 멀리까지 봐. 허수아비 뒤로 숨어서 다녀!',
    '다 모았어! 이 밭만 지나면 묘지 정원이야.',
  ],
  [
    '마지막 정원이야. 자정 종이 울리기 전에 나가야 해!',
    '까마귀 박사는 멀리까지 봐. 비석 뒤로 살금살금 다녀.',
    '그런데… 이 쪽지를 누가 찢었는지 궁금하지 않아? 나가면 알려 줄게.',
    '이게 마지막 문제야. 너희라면 꼭 풀 수 있어!',
  ],
];
const LUMI_EN = [
  [
    "That note is a riddle the owner of this manor left. Collect all four pieces and it becomes a question!",
    "If a monster chases you, throw candy. Monsters go crazy for candy!",
    "Doesn't it feel like the portrait at the end of the hall is watching you? …Oh, never mind!",
    'Now press the note button. Drag the pieces so the edges with the same color touch!',
  ],
  [
    "These books haven't changed in a hundred years. I used to love reading here… I mean, I heard that!",
    'The skeleton knight has sharp ears. If it chases you, hide in a wardrobe.',
    'Watch out for the spider between the shelves! It jumps out if you get close.',
    "You got them all! Solve the question and the door down to the cellar will open.",
  ],
  [
    'The note was in a barrel! It smells like hundred-year-old pumpkin jam down here.',
    'The spider is guarding its nest. When it freezes, step to the side!',
    "The key room… I feel like I've been in there before. Strange.",
    'All four! Put them together and solve the question.',
  ],
  [
    "This bed… I feel like I've slept here before. Probably just my imagination?",
    "The dolls in the doll room are staring at you, right? Don't worry, they're nice.",
    'When the bat demon screeches, the reaper comes running! Use the wardrobes well.',
    'You got them all! Put the note together.',
  ],
  [
    'You found it in the pumpkin vines! Long ago, jack-o\'-lanterns were carved from these pumpkins.',
    "The scarecrow is just a scarecrow… probably.",
    'Doctor Crow can see very far. Sneak behind the scarecrows!',
    'All four! After this field comes the graveyard garden.',
  ],
  [
    "This is the last garden. We have to get out before the midnight bell!",
    'Doctor Crow can see very far. Tiptoe behind the gravestones.',
    "By the way… don't you wonder who tore these notes? I'll tell you when you get out.",
    'This is the last question. I know you can solve it!',
  ],
];
const LUMI = T(LUMI_KO, LUMI_EN);

// 아이 대사: 주운 쪽지 글을 그대로 읽는다(문제 내용과 이어지게)
const KID = T([
  (t) => `찾았다! 찢어진 쪽지에 "${t}"라고 쓰여 있어.`,
  (t) => `하나 더! 이번엔 "${t}"… 앞 조각이랑 이어질 것 같아.`,
  (t) => `"${t}" — 세 번째 조각이야. 하나만 더 찾으면 돼!`,
  (t) => `마지막 조각! "${t}". 이제 이어 붙여 보자!`,
], [
  (t) => `Found one! The torn note says "${t}".`,
  (t) => `Another one! This one says "${t}"… it might connect to the first piece.`,
  (t) => `"${t}" — that's the third piece. Just one more!`,
  (t) => `The last piece! "${t}". Let's put them together!`,
]);

// 두 번째 쪽지부터
const LUMI_MORE = T([
  '새 쪽지다! 이번 것도 네 조각이야.',
  '좋아, 하나 더! 감지기를 잘 봐.',
  '세 조각째! 괴물들이 점점 화가 난 것 같아.',
  '다 모았어! 이어 붙여서 문제를 풀어 봐.',
], [
  'A new note! This one has four pieces too.',
  'Nice, one more! Keep an eye on the detector.',
  'Three pieces! The monsters seem to be getting angry.',
  'All four! Put them together and solve the question.',
]);

// 층을 시작할 때 루미가 하는 말
export const STAGE_INTRO = T([
  ['쪽지는 가구 속에 숨겨져 있어! 반짝이는 책장·탁자 옆에서 단추를 눌러 뒤져 봐. 위의 감지기가 뜨거워지면 가까운 거야.', '네 조각을 다 모아서 이어 붙이면 문제가 돼. 그 문제를 풀면 탈출문이 열려!'],
  ['지하 서고야. 여기도 쪽지 네 조각이 책장 사이에 숨겨져 있어. 감지기를 잘 봐!'],
  ['나무통 사이 거미줄 조심해! 거미가 둥지를 지키고 있어.', '쪽지 네 조각을 모아 문제를 풀면 2층으로 올라가는 계단이 열려.'],
  ['계단을 올라 저택 2층이야. 여기는… 왠지 내가 잘 아는 곳 같아.', '여기도 쪽지 네 조각을 찾아 이어 붙여야 해. 시간을 잘 봐!'],
  ['정원으로 가려면 호박밭을 지나야 해. 허수아비가 방금 움직인 것 같지 않았어?', '여기도 쪽지 네 조각을 찾아야 해!'],
  ['마지막 묘지 정원이야. 쪽지 네 조각을 모아 문제를 풀면 진짜 출구가 열려!', '자정까지 얼마 안 남았어. 서두르자!'],
], [
  ['The note pieces are hidden inside furniture! Stand next to a glowing bookshelf or table and press the button to search. When the detector at the top gets hot, you are close.', 'Put all four pieces together to make a question. Solve it and the exit opens!'],
  ['This is the underground library. Four note pieces are hidden between the shelves here too. Watch the detector!'],
  ['Watch out for cobwebs between the barrels! A spider is guarding its nest.', 'Collect four pieces and solve the question to open the stairs to the second floor.'],
  ["Up the stairs to the manor's second floor. This place… somehow feels very familiar to me.", 'Find four note pieces here too and put them together. Watch the time!'],
  ['To reach the garden we have to cross the pumpkin patch. Did that scarecrow just move?', 'Find four note pieces here too!'],
  ['The graveyard garden, the last one. Collect four pieces and solve the question to open the real way out!', "It's almost midnight. Hurry!"],
]);
// 층을 깬 뒤 보여 줄 만화(마지막 층은 엔딩 만화)
export const AFTER_COMIC = { 0: 'after1', 1: 'cellar2', 2: 'upstairs', 3: 'after2', 4: 'gate' };

export const LUMI_FACE = 'assets/faces/lumi.jpg';

// 층 대사는 첫 쪽지에서, 네 번째 조각 대사(층 마무리 말)는 마지막 쪽지에서만 한다(1층은 붙이는 법 안내라 첫 쪽지에서)
export function fragLines(stageIdx, n, part, kid, hint, round = 0, last = true) {
  const k = Math.max(1, Math.min(4, n)) - 1;
  const own = k < 3 ? round === 0 : stageIdx === 0 ? round === 0 : last;
  const lines = [
    { face: kid.face, name: kid.name, color: kid.color, text: KID[k](part) },
    { face: LUMI_FACE, name: T('루미', 'Lumi'), color: '#9fd8ff', text: own ? LUMI[stageIdx % LUMI.length][k] : LUMI_MORE[k] },
  ];
  if (hint) lines.push(lumiLine(hint));
  return lines;
}
export const lumiLine = (text) => ({ face: LUMI_FACE, name: T('루미', 'Lumi'), color: '#9fd8ff', text });

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
  b.hidden = false; document.getElementById('app').classList.add('dlg-on'); b.classList.remove('in'); void b.offsetWidth; b.classList.add('in');
  // 글자를 한 자씩(초등학생이 따라 읽기 좋게 조금 천천히)
  let i = 0; clearInterval(typing);
  typing = setInterval(() => { i++; line.textContent = l.text.slice(0, i); if (i >= l.text.length) clearInterval(typing); }, 28);
  clearTimeout(timer); timer = setTimeout(next, 2200 + l.text.length * T(75, 45));   // 영어는 글자 수가 많아서 글자당 시간을 줄인다
}
function next() {
  clearTimeout(timer); clearInterval(typing);
  const l = queue.shift();
  if (l) show(l); else if (box) { box.hidden = true; document.getElementById('app').classList.remove('dlg-on'); }
}
export function say(lines) {
  const idle = !box || box.hidden;
  queue.push(...lines);
  if (idle) next();
}
export function clearDialog() { queue.length = 0; clearTimeout(timer); clearInterval(typing); if (box) box.hidden = true; document.getElementById('app').classList.remove('dlg-on'); }
export const dialogOpen = () => !!box && !box.hidden;
