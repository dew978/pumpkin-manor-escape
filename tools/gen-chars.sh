#!/bin/bash
# 캐릭터 원화 후보: 분장마다 2장(병렬), 분장은 차례로
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8 SPRITE_GEN_ROOT=/c/Users/ndh10/.claude/skills/sprite-gen
export PATH="/c/Users/ndh10/AppData/Local/OpenAI/Codex/bin/e78bad9887fa50cf:$PATH"
B=/c/Users/ndh10/Documents/halloween-escape/art/chars
for c in ${@:-witch vampire pumpkin mummy}; do
  for i in 1 2; do
    $SPRITE_GEN_ROOT/.venv/bin/sprite-gen gen --provider codex --prompt-file $B/$c/prompt.txt --ref $B/_ref/kail_style.png --direction front --out $B/$c/c$i.png --report $B/$c/c$i.json > $B/$c/c$i.log 2>&1 &
  done
  wait
  echo "$c done: $(ls $B/$c/*.png 2>/dev/null | tr '\n' ' ')"
done
