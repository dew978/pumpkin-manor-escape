// 한국어 조사: 받침이 있으면 앞 글자, 없으면 뒤 글자. josa('보리', '이가') → '보리가'
export function josa(word, pair) {
  const ch = String(word).trim().slice(-1), code = ch.charCodeAt(0) - 0xac00;
  const has = code >= 0 && code <= 11171 ? code % 28 !== 0 : /[0-9]$/.test(ch) ? '013678'.includes(ch) : false;
  return word + (has ? pair[0] : pair[1]);
}

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가: 무시 */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* 저장 불가: 무시 */ } },
};

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtTime = t => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
