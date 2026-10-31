# ClickStack schema discovery

Run these first from `repos/engagement-service` through the `engagement-logs-read` query wrapper:

```sql
SELECT name, engine, total_rows
FROM system.tables
WHERE database = currentDatabase()
ORDER BY name
LIMIT 100
```

```sql
SELECT table, name, type
FROM system.columns
WHERE database = currentDatabase()
  AND table IN ('otel_logs', 'otel_metrics_gauge', 'otel_metrics_sum', 'otel_metrics_histogram', 'otel_traces')
ORDER BY table, position
LIMIT 200
```

OpenTelemetry metrics normally use `MetricName`, `Attributes`, `TimeUnix`, and `Value`; logs normally use `Timestamp`, `Body`, `ResourceAttributes`, and `LogAttributes`; traces normally use `Timestamp`, `SpanName`, `Duration`, `StatusCode`, `ResourceAttributes`, and `SpanAttributes`. Confirm the actual Kubernetes keys before filtering, commonly `k8s.namespace.name`, `k8s.pod.name`, `k8s.container.name`, `k8s.deployment.name`, and `k8s.node.name`.

Validated in the Driva ClickStack on 2026-09-20: Kubernetes identity is present in `otel_metrics_gauge.ResourceAttributes` (not only metric `Attributes`). Confirmed metric names include `k8s.container.ready`, `k8s.container.restarts`, `k8s.container.cpu_request`, `k8s.container.cpu_request_utilization`, `k8s.container.cpu_limit`, `k8s.container.cpu_limit_utilization`, `k8s.container.memory_limit`, `k8s.container.memory_limit_utilization`, `k8s.pod.cpu.usage`, `k8s.pod.cpu_request_utilization`, `k8s.pod.cpu_limit_utilization`, `k8s.pod.memory.usage`, `k8s.pod.memory.working_set`, `k8s.deployment.available`, and `k8s.deployment.desired`. The exact sample interval is visible in `TimeUnix`.

Do not infer a restart from `k8s.container.ready=0`: in the tested data, pod `engagement-worker-5cb8cf99cd-9v2pt` had `ready` values spanning 0..1 while `k8s.container.restarts` remained 0. Do not infer CPU saturation from CPU usage alone: in the same window its `k8s.container.cpu_request_utilization` peaked at about 0.34.


To discover resource keys without dumping payloads:

```sql
SELECT key, count() AS rows
FROM otel_logs
ARRAY JOIN mapKeys(ResourceAttributes) AS key
WHERE Timestamp >= now() - INTERVAL 24 HOUR
GROUP BY key
ORDER BY rows DESC
LIMIT 100
```

Repeat against metric `Attributes` and use `MetricName` groups before selecting a specific metric.
