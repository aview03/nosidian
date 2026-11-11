# kubectl 치트시트

자주 쓰는 것만 모았다. 네임스페이스는 `-n payments`.

## 상태 확인
```bash
kubectl -n payments get pods -o wide
kubectl -n payments describe pod <pod>
kubectl -n payments top pod --sort-by=memory
```

## 로그
```bash
kubectl -n payments logs deploy/gateway -f --tail=200
kubectl -n payments logs <pod> -c sidecar --previous
```

## 롤아웃
```bash
kubectl -n payments rollout status deploy/gateway
kubectl -n payments rollout history deploy/gateway
kubectl -n payments rollout undo deploy/gateway --to-revision=7
```

## 디버깅
```bash
kubectl -n payments exec -it deploy/gateway -- sh
kubectl -n payments port-forward svc/gateway 8080:80
kubectl get events --sort-by=.lastTimestamp | tail -20
```

관련: [[장애 회고 2026-11-05]], [[릴리스 체크리스트]] #kubernetes #ops
