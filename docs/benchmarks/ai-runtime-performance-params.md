# ai-runtime Performance Parameter Analysis

> Configuration file: `/data/etc/ai-runtime.yaml`
> Source code: `<repo-root>/platform/ai-runtime/`

---

## Configuration Overview

```yaml
# Inference scheduler configuration
scheduler:
  global_qps_limit: 100
  global_concurrent_limit: 8
  default_session:
    max_qps: 30
    max_concurrent: 2
    priority: 5
  strategy: fair
  queue_size: 64
  timeout_ms: 5000

# Performance configuration
performance:
  device_mode: high
  batch_enabled: false
  batch_size: 1
  batch_timeout_ms: 100
  max_model_cache: 3
  memory_limit_mb: 2048
```

---

## Parameter-by-Parameter Analysis

### scheduler Section

#### `global_qps_limit: 100`

- **Meaning**: Global maximum inference requests per second
- **Code consumption**: **Not implemented** -- The `Config` struct has a `global_qps_limit` field, but no business code reads it
- **Current behavior**: No QPS throttling
- **Intended use**: Prevent mass clients from simultaneously sending inference requests and overloading the NPU

#### `global_concurrent_limit: 8`

- **Meaning**: Global maximum concurrent inference count
- **Code mapping**: `cfg.scheduler_workers` -> `InferenceScheduler`'s `num_workers_`
- **Actual effect**: Starts **8 worker threads** simultaneously pulling requests from the queue for inference execution
- **Code path**: `main.cpp:85` -> `InferenceScheduler(model_mgr, session_mgr, 8, 64)`

```
                    +--- Worker 0 --> NPU Infer --+
                    +--- Worker 1 --> NPU Infer --+
Request Queue -->   +--- Worker 2 --> NPU Infer --+--- Callback
  (64 slots)        +--- ...                      |
                    +--- Worker 7 --> NPU Infer --+
```

- **Tuning advice**: 8 threads suits multi-model parallel scenarios. For single-model scenarios, 3-4 threads are sufficient; extra threads will idle waiting

#### `default_session.max_qps: 30`

- **Meaning**: Default QPS limit per session
- **Code consumption**: **Not implemented** -- Field exists but is unused
- **Intended use**: Limit inference request frequency for individual clients

#### `default_session.max_concurrent: 2`

- **Meaning**: Maximum concurrent inference count per session
- **Code consumption**: **Not implemented** -- Field exists but is unused
- **Intended use**: Limit the number of simultaneous inference requests per client

#### `default_session.priority: 5`

- **Meaning**: Default session priority (higher values = higher priority)
- **Code consumption**: **Not implemented** -- Current scheduler uses Round-Robin fair rotation, no priority sorting
- **Intended use**: Takes effect when `strategy: priority`

#### `strategy: fair`

- **Meaning**: Scheduling strategy selection
- **Available values**: `fair` | `priority` | `fifo`
- **Code consumption**: **Not implemented** -- Declared in config file but **hardcoded as Round-Robin Fair Queueing** in code
- **Current implementation**: `inference_scheduler.cpp:81-105`

```cpp
// Round-robin selection -- each session takes turns fetching one request
do {
    if (rr_index_ >= active_sessions_.size())
        rr_index_ = 0;
    const std::string& sid = active_sessions_[rr_index_];
    auto& sq = session_queues_[sid];
    if (!sq.empty()) {
        req = std::move(sq.front());
        // ...
    }
} while (!active_sessions_.empty());
```

- **Effect**: When multiple clients perform inference simultaneously, they execute in **fair rotation**, preventing any from being starved

#### `queue_size: 64`

- **Meaning**: Maximum capacity of the inference request queue
- **Code mapping**: `cfg.scheduler_queue_size` -> `queue_capacity_`
- **Actual effect**: At most 64 pending requests can accumulate in the queue. Beyond that, new requests are dropped immediately

```cpp
// inference_scheduler.cpp:46
if (total_queued_ >= queue_capacity_) {
    LOG_WARN("Inference queue full (%d), dropping request", queue_capacity_);
    return false;
}
```

- **Tuning advice**: 64 is sufficient for 8 workers. Each request typically waits in the queue for < 10ms

#### `timeout_ms: 5000`

- **Meaning**: Inference request timeout
- **Code consumption**: **Not implemented** -- Written to `InferRequest::timeout_ms` but worker threads do not check timeout
- **Current behavior**: Requests are never cancelled due to timeout

---

### performance Section

#### `device_mode: high`

- **Meaning**: NPU performance/power mode
- **Available values**: `high` | `normal` | `low`
- **Code consumption**: **Partially implemented** -- Stored in `cfg.device_mode` but not passed to HAL/HailoRT
- **HailoRT corresponding API**: `hailortcli fw-control set-power-mode` can switch power mode

| Mode | Expected Behavior |
|------|-------------------|
| `high` | NPU runs at full speed, 20 TOPS, highest power consumption |
| `normal` | Downclocked, approximately 15 TOPS |
| `low` | Minimum power, approximately 10 TOPS or below |

- **Current actual behavior**: HailoRT firmware defaults to high-performance mode; config value does not affect actual behavior
- **Activation method**: Needs to call HailoRT power mode API during HAL initialization

#### `batch_enabled: false`

- **Meaning**: Whether to enable inference batching (combine multiple requests into one inference)
- **Code consumption**: **Not implemented** -- Declared in YAML but not parsed or used
- **Principle**:

```
Disabled (false):
  Request 1 --> NPU --> Result 1   (21ms)
  Request 2 --> NPU --> Result 2   (21ms)
  Total: 42ms

Enabled (true, batch_size=4):
  Request 1 |
  Request 2 +--> NPU (batch=4) --> Result 1,2,3,4  (30ms)
  Request 3 |
  Request 4 |
  Total: 30ms + wait time
```

- **Applicable scenario**: When multiple clients simultaneously perform inference on the same model, throughput can be improved
- **Risk**: Increases P99 latency (must wait to fill batch or timeout)

#### `batch_size: 1`

- **Meaning**: Batch processing size
- **Code consumption**: **Not implemented**
- **Valid range**: 1-8 (depends on batch dimension set during model compilation)

#### `batch_timeout_ms: 100`

- **Meaning**: Batch wait timeout -- if batch_size cannot be filled, start inference after at most 100ms
- **Code consumption**: **Not implemented**
- **Tuning**: Shorter timeout means lower latency but less throughput gain; longer timeout means higher throughput but higher latency

#### `max_model_cache: 3`

- **Meaning**: Maximum number of models that can reside in NPU simultaneously
- **Code consumption**: **Not implemented** -- No LRU eviction; once registered, models remain in memory until explicitly deregistered
- **Current behavior**: No limit; models can be registered as long as memory is sufficient
- **Observed**: Successfully loaded 4 models simultaneously (see benchmarks)

#### `memory_limit_mb: 2048`

- **Meaning**: Total memory limit for weight tensors of all registered models
- **Code consumption**: **Not implemented** -- Memory limit is not checked when registering models
- **Current behavior**: The only memory limit is physical DDR (8 GB)

---

## Parameter Activation Status Summary

| Parameter | Config Value | Code Status | Actually Active |
|-----------|-------------|-------------|-----------------|
| `global_qps_limit` | 100 | **Not consumed** | No |
| `global_concurrent_limit` | 8 | **Consumed** -> worker count | Yes (8 threads) |
| `default_session.max_qps` | 30 | **Not consumed** | No |
| `default_session.max_concurrent` | 2 | **Not consumed** | No |
| `default_session.priority` | 5 | **Not consumed** | No |
| `strategy` | fair | **Not consumed** (hardcoded RR) | Partial (fixed fair rotation) |
| `queue_size` | 64 | **Consumed** -> queue capacity | Yes |
| `timeout_ms` | 5000 | **Not consumed** | No |
| `device_mode` | high | **Not consumed** (HAL not called) | No |
| `batch_enabled` | false | **Not consumed** | No |
| `batch_size` | 1 | **Not consumed** | No |
| `batch_timeout_ms` | 100 | **Not consumed** | No |
| `max_model_cache` | 3 | **Not consumed** | No |
| `memory_limit_mb` | 2048 | **Not consumed** | No |

**Only 2 parameters are actually active**: `global_concurrent_limit` (worker thread count) and `queue_size` (queue capacity).

---

## Actual Scheduler Workflow

```
Client gRPC inference request
         |
         v
   +------------------+
   |  submit()        |  <- Check queue_capacity (64)
   |  Route by        |
   |  session_id into |
   |  separate queues |
   +--------+---------+
            |
            v notify_one()
   +------------------+
   |  8 Workers       |  <- global_concurrent_limit
   |  Round-Robin     |
   |  fair rotation   |
   +--------+---------+
            |
            v
   +------------------+
   |  ModelManager    |
   |  .infer()        |  <- Call HAL -> HailoRT -> NPU
   +--------+---------+
            |
            v
   +------------------+
   |  on_complete()   |  <- Callback with result
   |  Callback        |
   +------------------+
```

Key characteristics:
- **Session-level fair scheduling**: Requests from different clients (sessions) are executed in rotation, preventing mutual starvation
- **No priority**: All session requests have equal weight
- **No timeout**: Requests are never cancelled due to waiting too long
- **No QPS throttling**: Clients can submit requests at unlimited speed, bounded only by queue capacity of 64

---

## Recommended Tuning Values

### Scenario 1: Single Application Single Model (Current model-showcase)

```yaml
scheduler:
  global_concurrent_limit: 4    # Reduce threads, lower CPU overhead
  queue_size: 32                # Single client does not need large queue
```

### Scenario 2: Multi-Application Multi-Model Parallel

```yaml
scheduler:
  global_concurrent_limit: 8    # Keep 8 threads to match NPU scheduling capacity
  queue_size: 64                # Keep large queue to absorb bursts
```

### Scenario 3: High Throughput Batching (Requires batch logic implementation)

```yaml
performance:
  batch_enabled: true
  batch_size: 4
  batch_timeout_ms: 50
```