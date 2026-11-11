# SQL 슬로우쿼리 분석

Postgres에서 느린 쿼리를 찾고 인덱스를 확인하는 순서.

## 1. 가장 오래 걸린 쿼리 (pg_stat_statements)
```sql
SELECT calls,
       round(total_exec_time::numeric, 1) AS total_ms,
       round(mean_exec_time::numeric, 2)  AS mean_ms,
       left(query, 100) AS q
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

## 2. 실행 계획
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM payments
WHERE user_id = 42 AND status = 'PENDING'
ORDER BY created_at DESC
LIMIT 20;
```
`Seq Scan`이 보이면 복합 인덱스를 검토한다.

## 3. 인덱스 추가 (동시 생성)
```sql
CREATE INDEX CONCURRENTLY idx_payments_user_status_created
  ON payments (user_id, status, created_at DESC);
```

## 커넥션 풀
- pgbouncer `pool_mode = transaction`
- `default_pool_size`는 DB `max_connections`의 60% 이내

관련: [[장애 회고 2026-11-05]] #postgres #sql
