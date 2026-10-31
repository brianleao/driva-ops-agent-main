---
name: kubernetes-observability-read
description: Read-only investigation of Kubernetes pod, probe, restart, resource, event, metric, and rollout symptoms using the Driva ClickStack/HyperDX OpenTelemetry data. Use when an alert mentions a pod, container, readiness/liveness, CrashLoopBackOff, OOM, eviction, CPU, memory, throttling, node, or deployment rollout.
---

# Kubernetes observability read

Use this skill for infrastructure/runtime evidence that application log skills do not establish. It is read-only: never restart, scale, redeploy, delete, requeue, or mutate Kubernetes or ClickHouse state.

## Data source

Reuse the ClickHouse credentials and read-only wrapper already used by `engagement-logs-read`:

```bash
cd <repos-root>/engagement-service
node .codex/skills/engagement-logs-read/scripts/query.js "<one read-only query>"
```

The current Driva ClickStack database exposes (verify before relying on names): `otel_logs`, `otel_metrics_gauge`, `otel_metrics_sum`, `otel_metrics_histogram`, and `otel_traces`. Discover columns with `system.columns`; do not assume Kubernetes attributes were preserved.

## Investigation workflow

1. Extract namespace, pod, container, workload, node, alert time, and UTC window from the alert. If namespace is absent, report that limitation.
2. Discover Kubernetes resource keys in `ResourceAttributes`, `Attributes`, and `LogAttributes` using bounded, aggregate queries.
3. Query logs for Kubernetes event/probe/restart/OOM/eviction messages and group by resource, severity, and message pattern before fetching rows.
4. Query metrics for the affected pod/container in the same window. Inspect metric names and units first; then evaluate CPU usage, CPU throttling, memory working set/limit, restart counters, readiness, and probe counters when present.
5. Query traces for the affected service/pod only when latency, blocked health endpoints, or downstream dependency behavior could explain the probe failure.
6. Correlate with application logs from the relevant service skill. Kubernetes evidence establishes what the runtime did; application logs establish what the process was doing.
7. Separate facts, inference, discarded hypotheses, and missing telemetry. Do not call CPU the cause merely because CPU was elevated; seek temporal alignment with throttling or probe failure.

## Restart/probe correlation pattern

For a reported restart time, query at least 3 minutes before through 3 minutes after the event and group by the exact pod name. Do not merge metrics from an old and a new ReplicaSet. Compare, in order:

```text
k8s.container.ready:       1 -> 0
k8s.container.restarts:    N -> N+1
k8s.container.cpu_request_utilization: rises above 1.0
```

If those transitions occur in the same minute, treat them as correlation evidence and compare competing explanations. CPU pressure is only one hypothesis. This is not proof of CPU throttling: separately inspect `k8s.container.cpu_limit_utilization` and any throttling metric available in the schema. `cpu_request_utilization > 1` means the container exceeded its request; it does not necessarily mean it hit its limit.

Use `TimeUnix` in UTC. Convert user/Grafana local times before querying. For example, 17:33 BRT is 20:33 UTC. When a pod name changes around the incident, establish the old pod's final samples and the new pod's first samples separately before forming a causal chain.

## Required interpretations

- `Readiness probe failed` means the pod was removed from service endpoints; it does not by itself prove a restart.
- `Liveness probe failed`, a terminated container state, or an increasing restart counter supports a restart diagnosis.
- `OOMKilled` is memory evidence, not a generic restart category.
- CPU saturation is stronger when usage is near the limit and throttling rises before the probe/restart.
- A repeated pattern of resource utilization, readiness changes, and restart-count changes is correlation evidence; identify the resource and competing causes from the available metrics and events rather than assuming CPU.
- `Evicted`, `Preempted`, `NodeNotReady`, and rollout events are separate infrastructure causes.
- Missing Kubernetes events in ClickStack is a telemetry gap, not evidence that no event occurred.

## Query safety

Use only the approved wrapper and read-only statements. Include a narrow time predicate for log/metric/trace queries, limit rows, prefer aggregates, and redact payloads and identifiers that are not needed. Record query/source failures separately; do not turn a wrapper failure into an incident conclusion.

## Output

Return a concise incident report containing scope and UTC window, sources queried, timeline, Kubernetes facts, application facts, causal chain, confidence, gaps, and the smallest next diagnostic step. Name the ClickHouse table and relevant attribute/metric names so another engineer can audit the result.
