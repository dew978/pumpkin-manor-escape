// 스테이지 지도, 괴물 성능. 지도 기호는 아래와 같다.
//
//  #  벽(정원은 산울타리)     E  탈출문(퍼즐을 풀면 열림)   P  시작 위치
//  f  쪽지 조각 후보 칸      i  아이템 후보 칸            H  옷장(숨는 곳)
//  X  유령 새장(잡힌 친구)   L  등불(빛)                  C  샹들리에(빛)
//  c  호박 상자(문제를 맞히면 아이템)
//  B  책장  Q  식탁  T  작업대  h  의자  R  왕좌  b  나무통  o  부엉이상
//  g  묘비  t  나무  s  허수아비  w  우물
//  r  저승사자  k  해골 기사  v  박쥐 악마  x  거미  d  까마귀 박사
//
// 지도는 36×25. 태블릿 조이스틱으로도 다니기 쉽게 통로는 2칸 이상, 문은 3~4칸으로 넓게 둔다.
// 세 구역(A 11칸 · B 10칸 · C 11칸) 줄은 R()이 모자란 칸을 바닥으로 채워 길이를 맞춘다.

const W = 36;
const pad = (s, n) => (s + '.'.repeat(n)).slice(0, n);
const R = (a, b, c) => '#' + pad(a, 11) + '#' + pad(b, 10) + '#' + pad(c, 11) + '#';
const HALL = (s) => '#' + pad(s, W - 2) + '#';
const WALLS = '#' + '####...####' + '#' + '###....###' + '#' + '####...####' + '#';
const TOP = '#'.repeat(17) + 'EE' + '#'.repeat(17);
const BOTTOM = '#'.repeat(W);
// 세로 벽(12칸·23칸)에 3칸 높이 문을 낸다
function withDoors(rows, doorRows) {
  return rows.map((row, r) => {
    if (!doorRows.includes(r)) return row;
    const a = row.split(''); a[12] = '.'; a[23] = '.'; return a.join('');
  });
}
import { T, LANG } from './util.js';

const DOORS = [9, 10, 11, 19, 20, 21];

export const STAGES = [
  {
    id: 1, name: T('저택 1층', 'Mansion 1F'), sub: T('현관 · 도서관 · 식당', 'Hall · Library · Dining room'), style: 'manor', time: 480,
    fog: 0x150c20, ambient: 0.05,
    map: withDoors([
      TOP,
      HALL('L..H.....f.......C.........i..H..L'),
      HALL('..........r.......................'),
      HALL('..................................'),
      HALL('....i....................f........'),
      WALLS,
      R('...........', 'o........o', '...........'),
      R('.BBB...BBB.', '..........', '..hQQQQh...'),
      R('...........', '....C.....', '...........'),
      R('...........', '..........', '..........c'),
      R('.BBB...BBB.', '....v.....', 'b.........f'),
      R('f..........', '..........', '...........'),
      R('.........c.', '.i......f.', '..H....i...'),
      R('.BB..H..BB.', '..........', '...........'),
      R('...........', 'o........o', 'b.........b'),
      WALLS,
      R('...........', '..........', '...........'),
      R('.T......R..', '.L......L.', '.T.....T...'),
      R('...........', '..........', '...........'),
      R('.......f...', '....P.....', 'f..........'),
      R('..H........', '..........', '.....b.....'),
      R('...........', '..........', '...........'),
      R('i..........', '..........', '.X......H..'),
      R('L........c.', 'c........c', 'b.......i.L'),
      BOTTOM,
    ], DOORS),
  },
  {
    id: 2, name: T('지하 서고', 'Underground Library'), sub: T('책장 미로 · 해골 기사', 'Bookshelf maze · Skeleton knights'), style: 'cellar', time: 480,
    fog: 0x0b0f18, ambient: 0.05,
    map: withDoors([
      TOP,
      HALL('L...BBBB.............BBBB.......L.'),
      HALL('.f.........k.................i....'),
      HALL('..................................'),
      HALL('...H.......................H......'),
      WALLS,
      R('BB..BB..BB.', 'B..B..B..B', '.BB..BB..BB'),
      R('...x.......', '..........', '...........'),
      R('...........', '..........', 'i.........f'),
      R('BB..BB..BB.', '..........', '...........'),
      R('f.........i', 'B..B..B..B', '.BB..BB..BB'),
      R('...........', '..f....f..', '...........'),
      R('...........', '..........', '...H...k...'),
      R('BB..BB..BB.', 'B..B..B..B', '.BB..BB..BB'),
      R('..c..H.....', '..........', '....f....c.'),
      WALLS,
      R('...........', '..........', '...........'),
      R('.T.........', '.L......L.', '....T...T..'),
      R('...........', '..........', '...........'),
      R('b.......f..', '....P.....', 'f.......b..'),
      R('..H........', '..........', '......H....'),
      R('...........', '..........', '...........'),
      R('BBB...BBB..', '..........', '.....X.....'),
      R('L...i....c.', 'c........c', 'b...i.....L'),
      BOTTOM,
    ], DOORS),
  },
  {
    id: 3, name: T('지하 창고', 'Cellar'), sub: T('나무통 미로 · 거미 둥지', 'Barrel maze · Spider nest'), style: 'cellar', time: 480,
    fog: 0x0d0b10, ambient: 0.05,
    map: withDoors([
      TOP,
      HALL('L..bbb.....................bbb..L.'),
      HALL('.f..........k.................i...'),
      HALL('..........................b.......'),
      HALL('...H.......b..........b.......H...'),
      WALLS,
      R('b.b........', 'T........T', '........b.b'),
      R('...........', '..h....h..', '...........'),
      R('.bbb...bbb.', '..........', '.bbb...bbb.'),
      R('...........', '...TT.....', '..........c'),
      R('f....x.....', '.......k..', '..........f'),
      R('.bbb...bbb.', '..........', '.bbb...bbb.'),
      R('......H....', 'b..i.....b', '....H...i..'),
      R('.c.........', '..........', '...........'),
      R('bb......b.b', 'T........T', 'b.b......bb'),
      WALLS,
      R('...........', '..........', '...........'),
      R('.T.....h...', '.L......L.', '...h.....T.'),
      R('...........', '..........', '...........'),
      R('b......f...', '....P.....', '...f.....b.'),
      R('..H........', '..........', '.......H...'),
      R('...........', '..........', '...........'),
      R('bb.bb......', '..........', '.....X.....'),
      R('L...i....c.', 'c........c', 'b...i.....L'),
      BOTTOM,
    ], DOORS),
  },
  {
    id: 4, name: T('저택 2층', 'Mansion 2F'), sub: T('침실 · 인형 방 · 서재', 'Bedroom · Doll room · Study'), style: 'manor', time: 480,
    fog: 0x170b1c, ambient: 0.05,
    map: withDoors([
      TOP,
      HALL('L..H......o.......C.......o...H..L'),
      HALL('...............r..................'),
      HALL('..i...............................'),
      HALL('.....................i............'),
      WALLS,
      R('...........', 'o........o', '...........'),
      R('.QQQ...hh..', '..........', '.BBB...BBB.'),
      R('.QQQ.......', '....C.....', '...........'),
      R('.........c.', '..h....h..', '.BBB...BBB.'),
      R('b....v.....', '..........', '...........'),
      R('...........', '.h..QQ..h.', '.BBB...BBB.'),
      R('..H.....i..', '..........', '..........f'),
      R('.hh........', '.o......o.', '..H......c.'),
      R('b.......b..', '..........', 'b.........b'),
      WALLS,
      R('...........', '..........', '...........'),
      R('.BB..H..BB.', '.L......L.', '.R.....hh..'),
      R('...........', '..........', '...........'),
      R('.......f...', '....P.....', 'f..........'),
      R('..H........', '..........', '.....b.....'),
      R('...........', '..........', '...........'),
      R('i..........', '..........', '.X......H..'),
      R('L........c.', 'c........c', 'b.......i.L'),
      BOTTOM,
    ], DOORS),
  },
  {
    id: 5, name: T('호박밭', 'Pumpkin Patch'), sub: T('허수아비 마당 · 덩굴 미로', 'Scarecrow yard · Vine maze'), style: 'garden', time: 480,
    fog: 0x10140c, ambient: 0.06,
    map: withDoors([
      TOP,
      HALL('t...s.....t.....d.....t.....s...t.'),
      HALL('.........i.............f..........'),
      HALL('..t.......b..............w........'),
      HALL('..................................'),
      WALLS,
      R('t.........t', '..........', 't.........t'),
      R('..s....s...', '..t....t..', '...s....s..'),
      R('...........', '..........', '...........'),
      R('f..b.......', '....s.....', '.......b.f.'),
      R('.......t...', '..v.......', '...t...r...'),
      R('.....H.....', '.b......b.', '...H.......'),
      R('t.........i', '...w......', 'i.........t'),
      R('..s....s...', '..........', '..s....s..c'),
      R('t.......c.t', '..t....t..', 't.........t'),
      WALLS,
      R('...........', '..........', '...........'),
      R('.bb....b...', '.L......L.', '..t...t....'),
      R('...........', '..........', '...........'),
      R('.....f.....', '....P.....', '...f.......'),
      R('...H.......', '..........', '.....H.....'),
      R('...........', '..........', '...........'),
      R('bb..b......', '..........', '..X..t..i..'),
      R('L...i....c.', 'c........c', '...t.....L.'),
      BOTTOM,
    ], DOORS),
  },
  {
    id: 6, name: T('묘지 정원', 'Graveyard Garden'), sub: T('안개 낀 묘지 · 까마귀 박사 · 마지막 층', 'Foggy graveyard · Doctor Crow · Final floor'), style: 'garden', time: 480,
    fog: 0x0c1612, ambient: 0.06,
    map: withDoors([
      TOP,
      HALL('t..g...g...g.....d.....g...g...t..'),
      HALL('.............i.......f............'),
      HALL('..g.......w..............g........'),
      HALL('..................................'),
      WALLS,
      R('t.........t', '..g....g..', 't.........t'),
      R('...g...g...', '..........', '...g...g...'),
      R('...........', '..........', '....s......'),
      R('f..r.......', '...v......', '.........f.'),
      R('...g...g...', '..........', '...g...g...'),
      R('.....H.....', '.g......g.', '...H.......'),
      R('t.........i', 'f...w.....', 'i.........t'),
      R('...........', '..........', '...........'),
      R('...g...g..c', '..t....t..', '..c.g...g..'),
      WALLS,
      R('t..........', '..........', '..........t'),
      R('..s....g...', '.L......L.', '...g....s..'),
      R('...........', '..........', '...........'),
      R('.g...f.....', '....P.....', '...f....g..'),
      R('...H.......', '..........', '.....H.....'),
      R('...........', '..........', '...........'),
      R('..g...g....', '..........', '..X.....i..'),
      R('L...i....c.', 'c........c', '...i.....L.'),
      BOTTOM,
    ], DOORS),
  },
];

export const SOLID = new Set(['#', 'E', 'H', 'X', 'L', 'B', 'Q', 'T', 'h', 'R', 'b', 'c', 'o', 'g', 't', 's', 'w']);

// 속도 단위: 칸/초. 학생 기본 속도 3.4.
// 초등학생이 태블릿 조이스틱으로 피할 수 있게(2026-10-27 점검): 쫓는 속도는 학생보다 느리고, 오래 쫓아도 학생 속도를 넘지 않는다.
export const PLAYER_SPEED = 3.4;
export const MONSTERS = {
  r: { kind: 'reaper', name: T('저승사자', 'the Reaper'), model: 'reaper', h: 2.1, walk: 1.4, run: 2.8, accel: 0.02, sight: 6, fov: 1.3, hear: 1.8, float: 0.12, catches: true },
  d: { kind: 'plague', name: T('까마귀 박사', 'Doctor Crow'), model: 'plague', h: 1.95, walk: 1.3, run: 2.7, accel: 0.02, sight: 7, fov: 1.05, hear: 1.6, float: 0, catches: true },
  k: { kind: 'knight', name: T('해골 기사', 'the Skeleton Knight'), model: 'knight', h: 2.0, walk: 1.2, run: 2.3, accel: 0.015, sight: 5.5, fov: 1.7, hear: 1.3, float: 0, catches: true, shout: true },
  v: { kind: 'bat', name: T('박쥐 악마', 'the Bat Demon'), model: 'bat', h: 1.3, walk: 1.6, run: 2.4, accel: 0, sight: 4.5, fov: 6.3, hear: 0, float: 1.3, catches: false, flies: true, shout: true },
  x: { kind: 'spider', name: T('거미', 'the Spider'), model: 'spider', h: 0.9, walk: 1.2, run: 4.0, accel: 0, sight: 3.8, fov: 2.2, hear: 1.0, float: 0, catches: true, lunge: true },
};

export const ITEMS = {
  time: { name: T('모래시계', 'Hourglass'), model: 'hourglass', desc: T('시간 +30초', 'Time +30 s') },
  crystal: { name: T('수정구', 'Crystal Ball'), model: 'crystal', desc: T('가까운 괴물 6초 동안 눈멂', 'Blinds nearby monsters for 6 s') },
  potion: { name: T('날쌘 물약', 'Speed Potion'), model: 'potion', desc: T('5초 동안 빨라짐', 'Faster for 5 s') },
};

// 분장한 아이들(뼈대·동작 모델 kid). 모델이 없으면 예전 정지 모델(model)로 대신한다
export const CHARACTERS = [
  { kid: 'witch_sd', model: 'girl', costume: T('마녀', 'Witch'), color: '#b07cff', face: 'assets/faces/witch.jpg' },
  { kid: 'vampire_sd', model: 'boy', costume: T('흡혈귀', 'Vampire'), color: '#ff5a6b', face: 'assets/faces/vampire.jpg' },
  { kid: 'pumpkin_sd', model: 'redhood', costume: T('호박', 'Pumpkin'), color: '#ff9a3a', face: 'assets/faces/pumpkin.jpg' },
  { kid: 'mummy_sd', model: 'tealgirl', costume: T('미라', 'Mummy'), color: '#7fe0c8', face: 'assets/faces/mummy.jpg' },
];

// 괴물 세기: 'auto'는 학년에 맞춘다(1~4학년 느림, 5~6학년 보통)
export const DIFF_SPEED = { easy: 0.85, normal: 0.92, hard: 1.08 };
export const diffForGrade = (grade, setting) => setting && setting !== 'auto' ? setting : (grade <= 4 ? 'easy' : 'normal');

export const EDGE_COLORS = ['#e8573c', '#3cb4e8', '#8fd14f', '#c47be8', '#f2c230'];
export const CANDY_PER_FLOOR = 12;

// 괴물 자리: 느림(1~4학년 기본)에서는 거미를 빼서 길목을 막지 않게 한다(아이 플레이 점검 2026-10-27)
export const monsterSpots = (spots, diff) => spots.mon.filter(s => !(diff === 'easy' && s.ch === 'x'));

// 쪽지 찾기: 층마다 쪽지 한 장(4조각)을 모아 이어 붙이면 문제가 되고, 풀면 탈출문이 열린다. 가구 10곳 중 4곳에 조각을 넣는다(나머지는 꽝, 작은 보상)
export const SEARCH_SPOTS = 10;
export const SEARCH_LOCK = 6;    // 가구 문제를 틀리면 그 가구가 잠기는 시간(초). 다시 오면 다른 문제가 나온다
export const SEARCHABLE = {
  B: ['📚', T('책장', 'bookshelf')], Q: ['🍽️', T('식탁', 'dining table')], T: ['🧰', T('작업대', 'workbench')], b: ['🛢️', T('나무통', 'barrel')], R: ['👑', T('왕좌', 'throne')], o: ['🦉', T('부엉이상', 'owl statue')], h: ['🪑', T('의자', 'chair')],
  g: ['🪦', T('묘비', 'gravestone')], t: ['🌳', T('나무', 'tree')], s: ['🎃', T('허수아비', 'scarecrow')], w: ['🪣', T('우물', 'well')],
};
export const SEARCH_CODES = Object.keys(SEARCHABLE);

// 루미의 방 힌트용 이름(층 순서대로). 지도는 위 복도(1~4줄) · 가운데 방 셋(6~14줄) · 아래 방 셋(16~23줄), 세로 벽은 12·23칸
const ROOM_NAMES = [
  { top: '위층 복도', mid: ['도서관', '부엉이 홀', '식당'], bot: ['작업실', '현관', '창고'] },
  { top: '지하 복도', mid: ['서쪽 서고', '가운데 서고', '동쪽 서고'], bot: ['책 수리실', '지하 입구', '기록 보관실'] },
  { top: '창고 복도', mid: ['나무통 방', '거미 둥지', '잼 저장실'], bot: ['장작 창고', '계단 아래', '열쇠 방'] },
  { top: '2층 복도', mid: ['큰 침실', '인형 방', '서재'], bot: ['옷 방', '계단 홀', '음악실'] },
  { top: '북쪽 밭', mid: ['서쪽 호박밭', '허수아비 마당', '동쪽 호박밭'], bot: ['헛간', '밭 입구', '과수원'] },
  { top: '북쪽 묘지', mid: ['서쪽 정원', '우물가', '동쪽 정원'], bot: ['허수아비 밭', '정원 입구', '동쪽 묘비길'] },
];
const ROOM_NAMES_EN = [
  { top: 'the upper hallway', mid: ['the library', 'the owl hall', 'the dining room'], bot: ['the workshop', 'the front hall', 'the storeroom'] },
  { top: 'the basement hallway', mid: ['the west stacks', 'the middle stacks', 'the east stacks'], bot: ['the book repair room', 'the basement entrance', 'the archive'] },
  { top: 'the cellar hallway', mid: ['the barrel room', 'the spider nest', 'the jam pantry'], bot: ['the firewood store', 'under the stairs', 'the key room'] },
  { top: 'the 2F hallway', mid: ['the big bedroom', 'the doll room', 'the study'], bot: ['the wardrobe room', 'the stair hall', 'the music room'] },
  { top: 'the north field', mid: ['the west pumpkin patch', 'the scarecrow yard', 'the east pumpkin patch'], bot: ['the barn', 'the field entrance', 'the orchard'] },
  { top: 'the north graveyard', mid: ['the west garden', 'the well', 'the east garden'], bot: ['the scarecrow field', 'the garden gate', 'the east grave path'] },
];
export function roomName(stageIdx, c, r) {
  const names = LANG === 'en' ? ROOM_NAMES_EN : ROOM_NAMES;
  const R = names[stageIdx] || names[0];
  if (r <= 4) return R.top;
  const k = c <= 12 ? 0 : c <= 23 ? 1 : 2;
  return (r <= 14 ? R.mid : R.bot)[k];
}
