# git rebase 정리

## 브랜치 최신화
```bash
git fetch origin
git rebase origin/main
# 충돌 해결 후
git add -A && git rebase --continue
```

## 커밋 정리 (인터랙티브)
```bash
git rebase -i HEAD~4   # squash / fixup / reword
```

## 실수했을 때
```bash
git reflog              # 이전 HEAD 찾기
git reset --hard HEAD@{3}
```

> [!warning] 공유 브랜치는 rebase 하지 않는다
> 이미 push 한 공용 브랜치를 rebase 하면 다른 사람의 히스토리가 꼬인다. `--force-with-lease`만 허용.

#git
