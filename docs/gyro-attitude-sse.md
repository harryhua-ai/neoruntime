# 陀螺仪姿态 SSE 接口参数文档（水平校准）

> 面向后端实现 `GET /api/v1/monitor/gyro/attitude`（`text/event-stream`）的契约说明。
> 前端消费方：`web/src/pages/dashboard/components/GyroCalibrationCard.tsx`
> （经 `web/src/lib/gyroStream/gyroSSE.ts` 解析）。

## 1. 背景

水平校准卡片只关心「设备偏离水平多少」，不关心朝向（偏航/yaw）。因此姿态数据
**只用两轴倾角表达，不含 Z 轴（yaw）**。后端应在融合 IMU 数据后，把姿态投影为
两个角度下发，前端据此旋转可视化薄板（仅前后/左右倾斜，永不绕 Z 轴旋转）。

## 2. 坐标系与角度约定

世界系为 **Z-up**（+Z 向上），与设备顶面贴片一致：

| 轴 | 方向 |
|----|------|
| +X | 设备前方 |
| -X | 设备后方 |
| +Y | 设备右方 |
| -Y | 设备左方 |
| +Z | 向上 |

两个角度：

| 字段 | 含义 | 正值方向 | 取值范围 |
|------|------|----------|----------|
| `pitch` | 前后倾角（°） | 正 = 前倾（+X 侧下沉） | [-90, 90] |
| `roll`  | 左右倾角（°） | 正 = 右倾（+Y 侧下沉） | [-90, 90] |

> 推导：`pitch = atan2(up.x, up.z)`、`roll = atan2(up.y, up.z)`，其中 `up` 为设备
> 顶面法线在世界系下的向量。yaw 分量直接丢弃（不参与下发）。

水平判定（前端）：综合倾角 = `acos(up.z)`，≤ 2° 视为「水平」。

## 3. 接口

- **Method / Path**：`GET /api/v1/monitor/gyro/attitude`
- **Content-Type**：`text/event-stream`
- **鉴权**：EventSource 无法自定义请求头，token 走 query 参数（与音频对讲
  WebSocket 同一约定）。

### 3.1 Query 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `token` | string | 是 | — | 鉴权 token（裸值，不带 `Bearer ` 前缀） |
| `rate`  | int    | 否 | 50  | 输出频率上限（Hz），后端钳制到 [1, 200] |

> 旧版 `format=quaternion|euler` 参数已废弃，后端无需再支持。

### 3.2 SSE 事件

#### `orientation` —— 姿态帧（核心）

每帧 payload 为 JSON：

```json
{ "pitch": 12.34, "roll": -5.67 }
```

- `pitch`、`roll` 均为 number（浮点度数）。
- 必须是有限数（禁止 `NaN`/`Infinity`/`null`）；非数值帧会被前端静默丢弃。
- 建议下发频率不超过 `rate`，平稳时降频以省带宽。

SSE 原始行示例：

```
event: orientation
data: {"pitch":12.34,"roll":-5.67}

```

#### `status` —— 传感器健康

```json
{ "sensor": "online" }
```

`sensor` 取值：`online` / `offline` / `error`。

#### `error` —— 传感器错误详情

在非 `online` 状态后追加一条，携带可读错误信息（自由文本）。

#### `heartbeat` —— 保活

每 15s 一条空事件，保持连接不被代理掐断。

## 4. 连接生命周期

- 传感器瞬时不可用时**不要关闭流**，改发 `status`/`error` 事件，前端据此展示
  状态而无需重连。
- 仅当陀螺源被服务端禁用时返回 `503`（非 SSE）。此时 `EventSource` 进入
  `CLOSED` 并触发 `onError`，前端会回退到本地 Mock（仅 DEV 演示用）。
- 网络瞬时错误由 `EventSource` 自动重连，`onError` 触发但连接仍存活。

## 5. 前端解析逻辑（供后端对照）

```ts
es.addEventListener('orientation', (e) => {
  const d = JSON.parse(e.data);
  const { pitch, roll } = d;
  if (typeof pitch === 'number' && typeof roll === 'number'
      && Number.isFinite(pitch) && Number.isFinite(roll)) {
    onAttitude({ pitch, roll });
  }
});
```

## 6. 与旧版（四元数）的差异

| 项 | 旧版 | 新版 |
|----|------|------|
| 姿态表示 | 四元数 `[x,y,z,w]`（含 yaw） | 两角度 `{pitch, roll}`（无 yaw） |
| `orientation` payload | `{ "quaternion": [x,y,z,w] }` | `{ "pitch": <deg>, "roll": <deg> }` |
| Query `format` | `quaternion`/`euler` | 已废弃 |
| 可视化 | 薄板可绕 Z 旋转 | 薄板仅在前后/左右两轴倾斜，yaw 锁死 |
| HUD 读数 | 由四元数反解 | 直接显示收到的 pitch/roll |

## 7. 自测要点

- 设备平放 → `pitch≈0, roll≈0`，前端显示「水平」。
- 前端下沉 10° → `pitch≈+10`。
- 右侧下沉 10° → `roll≈+10`。
- 任意朝向旋转（绕 Z）→ `pitch`/`roll` 不应随之改变（yaw 已剥离）。
