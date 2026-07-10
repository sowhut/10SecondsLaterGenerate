# 10 Seconds Later —— 公开关卡编辑器 · 执行计划（PLAN）

> **这份文档是本仓库的唯一执行依据，自包含。** 新会话开工前请完整读一遍。
> 本仓库 = **对外开源的 Web 关卡编辑器 monorepo**。游戏引擎、美术、商业关卡、后端 secrets **都不在这里**，各自留在私有库。
> 最近更新：2026-07-10。

---

## 0. 一页速览

- **做什么**：把玩家能用的**关卡编辑器**做成公开网站 + GitHub 开源项目：在浏览器里作图 → **内嵌真实 Cocos 引擎试玩** → 作者亲测通关 → 导出/投稿。
- **为什么开源**：受众多来自 GitHub；开源编辑器做引流入口。**只开源"关卡格式 + 示例关卡 + 编辑器前端"，后端私有。**
- **不要重造引擎**：试玩必须用**真实 Cocos 引擎**（内嵌沙箱，postMessage 通信），否则"作者通关"不等于别人能通关。
- **美术不进库**：贴图按名字从托管端点取（`/sprites/<name>.png`），仓库里**不提交任何 PNG**。
- **运行模式**：编辑器可在用户本地或官网运行；两者都通过 `VITE_SANDBOX_URL`
  连接你部署的同一个 Cocos web 沙箱，GitHub 用户无需私有游戏源码即可试玩。
- **本仓库结构**：`pnpm` workspaces monorepo：`packages/schema` + `packages/editor` + `examples/`。

---

## 1. 背景与产品全景

**游戏本体**（私有库 `<game-repo>`）：Cocos Creator 3.8.8 + 纯 TS 的时间循环解谜平台跳跃游戏「10 Seconds Later / 10秒之后」。目标平台微信小游戏 + web-mobile。核心是**确定性 60 步/秒模拟 + 分身回放**：玩家先录制若干"分身"，最后本体与分身同台，持钥匙到门即通关。

**整体产品分三块**：① 官网介绍 ② 编辑器投稿 + 广场投票 + 管理员采纳（UGC）③ 网页版试玩。**本仓库负责 ②（Web 端 UGC 编辑器 + 投稿）**。

**已完成的地基（在游戏私有库里，已验证）**：
- 关卡已从硬编码抽离为**远程 JSON 热更**（小游戏免提审更新关卡）。
- Cocos 侧已具备**"试玩沙箱"运行时**：能接收任意草稿 `LevelDef`，用真引擎跑，回传是否通关（见 §5b 契约）。

---

## 2. 已定决策（不要推翻）

1. **开源范围**：`packages/schema`（关卡格式）+ `examples/`（示例关卡）+ `packages/editor`（编辑器前端）**全部开源**；**后端**（账号 / 投稿存储 / 审核 / 防作弊 / 广场）**私有**，放另一个私有库。
2. **仓库结构**：**本仓库整体公开**。游戏引擎/美术/商业关卡在游戏私有库；后端在后端私有库。**不做"私有库抠子目录开源"**（历史污染/泄露风险）。
3. **试玩保真**：**内嵌真实 Cocos web 构建**当沙箱，用 postMessage 传草稿、收结果。**禁止在 Web 侧重写物理/回放。**
4. **账号**：初期 **GitHub OAuth**（受众来自开源、摩擦最低）。属后端阶段；**现在就在导出信封里预留 `author` 字段**，接入零改造。
5. **美术不泄露**：贴图运行时从**可配置托管端点**按名取；仓库不提交 PNG。（服务端点公开可读 ≠ 把美术以开源许可授权出去。）
6. **单一数据源**：`LevelDef` 关卡格式以游戏私有库的 `assets/scripts/level/LevelDef.ts` 为事实源；本仓库 `packages/schema` 是它的公开镜像/契约（见 §5a、§6-M1）。
7. **自托管边界**：本仓库可独立启动编辑器，但完整试玩依赖官方托管 sandbox；本地编辑器和线上编辑器只是不同宿主 origin，不复制或公开 Cocos 源码。

---

## 3. 关联仓库与可复用来源（路径 + 复用什么）

| 来源 | 路径 | 复用什么 | 注意 |
|---|---|---|---|
| **游戏私有库** | `<game-repo>` | `assets/scripts/level/LevelDef.ts`（schema 事实源）；`assets/scripts/editor/PlaytestBridge.ts`/`EditorState.ts`（试玩契约实现）；`assets/scripts/Grid.ts`（网格常量）；`tools/export-levels.mts`（导出关卡 JSON 供示例）；`assets/resources/showcase/sprites/`（美术，**托管用、不复制进本库**） | 只读参考；**不把美术/引擎源码搬进本库** |
| **旧本地生成器** | `<local-generator>`（注意：是 `Secs` 那个旧目录，非本仓库） | `public/app.js`（**已实现地形编辑、承载校验 `hasSupport/findPlacementSupport`、rig 自动配色、0.5 吸附、Canvas 渲染**）、`public/index.html`、`public/styles.css` | **移植前端**；但 **丢弃其"写回 `LevelDef.ts`"的服务端**（`/api/levels/*`、`/api/level/create|delete` 会 `writeFile` 到游戏源码，属你私人作者流，不进公开编辑器） |

> 旧生成器保留给你私人出正式关卡用（它直接改游戏 `LevelDef.ts`）。**公开编辑器是它的"无写回"演进版**，产出改为导出 JSON / 提交后端。

---

## 4. 目标架构（monorepo 布局）

```
10SecondsLaterGenerate/            (本仓库，公开)
├─ package.json                    workspaces 根（pnpm 推荐）
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .gitignore                      (node_modules, dist, .DS_Store)
├─ LICENSE                         (代码 MIT 或 Apache-2.0)
├─ README.md                       (项目介绍 + 引流官网 + “不含美术”声明)
├─ CONTRIBUTING.md
├─ docs/
│   ├─ PLAN.md                     (本文件)
│   └─ LEVEL_FORMAT.md             (LevelDef 格式说明，给社区看)
├─ packages/
│   ├─ schema/                     @10s/schema
│   │   ├─ src/levelDef.ts         LevelDef 及所有子接口（§5a）
│   │   ├─ src/validate.ts         承载/存在性校验（从旧 app.js 提炼，§5d）
│   │   ├─ src/playtest.ts         试玩 postMessage 契约类型（§5b）
│   │   ├─ src/grid.ts             网格常量 + 坐标/占位辅助（§5c）
│   │   └─ src/index.ts            re-export
│   └─ editor/                     公开编辑器前端
│       ├─ index.html
│       ├─ src/app.ts (或 app.js)  移植自旧 public/app.js
│       ├─ src/playtestEmbed.ts    内嵌 Cocos 沙箱 iframe + postMessage（§5b）
│       ├─ src/exportSubmit.ts     本地草稿 + 导出 JSON + 提交后端 stub（§8）
│       ├─ src/config.ts           SPRITE_BASE_URL / SANDBOX_URL / API_BASE_URL（§7）
│       └─ styles.css
└─ examples/
    ├─ L1.json ... (2–3 个示例关卡，来自游戏 tools/export-levels.mts 产物)
    └─ README.md
```

- **工具链**：`pnpm` workspaces。`packages/schema` 用 TS 编译出 JS + `.d.ts`。`packages/editor` 可先保持 vanilla + 一个静态服务，或加 **Vite** 做 dev server / 构建（推荐 Vite，便于 env 注入与部署）。
- **部署**：`packages/editor` 构建成纯静态站，上你的官网/CDN。**沙箱 Cocos 构建和 sprites 由游戏库单独托管**，编辑器按 §7 的 URL 引用。
- **跨域嵌入**：sandbox 需允许官网编辑器和约定的 localhost origin 作为 `frame-ancestors`，并在 Cocos 的消息接收侧校验同一 allowlist；编辑器侧始终校验 sandbox origin + iframe source。

---

## 5. 共享契约（**必须精确遵守**）

### 5a. LevelDef schema（放进 `packages/schema/src/levelDef.ts`，逐字段照抄）

```ts
export interface SpawnDef { col: number; tier: number; w?: number; h?: number; } // 英雄默认 2×3
export interface RigDef {
  plate: { col: number; w: number; tier: number };
  lift: { col: number; w: number; restTier: number; topTier: number };
  color: string;
}
export interface LedgeDef { col0: number; col1: number; row: number; }       // 高台，col0..col1 含端点
export interface GroundTileDef { col: number; w?: number; }                  // 3 格地块，w 默认 3
export interface Tier2Def { col0: number; col1: number; gapCol0?: number; gapCol1?: number; }
export interface KeyDef { col: number; tier: number; w?: number; h?: number; dy?: number; } // 默认 1×2
export interface StoneDef { col: number; w: number; tier?: number; dy?: number; }           // 高 2，tier 默认 1
export interface SpikeDef { col: number; w: number; tier: number; dy?: number; }            // 高 2（致命带）
export interface WallDef { col: number; w: number; h: number; tier: number; }               // 可炸墙，默认 3×3
export interface BombDef { col: number; tier: number; dy?: number; }                        // 2×2
export interface BoxDef { col: number; tier: number; h?: number; dy?: number; }             // 2×h，h 默认 2
export interface PitDef { tier: number; col0: number; col1: number; cells?: number; }        // 地形裁切（非道具）
export interface ThemeDef { void: string; upper: string; lower: string; }
export interface DoorDef { col: number; tier: number; w: number; h: number; dy?: number; glow?: [string, number]; }

export interface LevelDef {
  name: string;
  recordSteps: number;        // 600 = 10s
  floorRows: number;
  minEngineVersion?: number;  // 省略=1；> 客户端引擎版本时被 gate 为“需要更新版本”
  comingSoon?: boolean;
  tier2?: Tier2Def;           // 旧式连续二层，优先用 tier2Tiles
  tier2Tiles?: GroundTileDef[];
  ledges?: LedgeDef[];
  rigs: RigDef[];             // 压力板↔升降台，最多 3 组，自动配色
  key: KeyDef;                // 唯一
  door: DoorDef;              // 唯一
  clones: number;             // 分身数（总角色 = clones + 1）
  spawn: SpawnDef;            // 唯一共享出生点
  theme?: ThemeDef;
  ground?: GroundTileDef[];
  stones?: StoneDef[];
  spikes?: SpikeDef[];
  walls?: WallDef[];
  bomb?: BombDef;
  boxes?: BoxDef[];
  pits?: PitDef[];
}
```

**投稿/导出信封**（与游戏 `tools/export-levels.mts` 一致，且预留作者）：
```ts
export interface LevelEnvelope {
  schemaVersion: number;      // 当前 1
  minEngineVersion: number;   // 默认 1
  def: LevelDef;
  author?: { id: string; name: string; provider: 'github' };  // 现在预留，后端阶段填充
}
```

### 5b. Cocos 试玩沙箱契约（**已在游戏库 `editor/PlaytestBridge.ts` 实现**）

内嵌方式：编辑器把**托管的 Cocos web 构建**放进 `<iframe>`；双方用 `window.postMessage` 通信。

```
宿主(编辑器) → Cocos:   { type: '10s.playtest', def: LevelDef, returnScene?: string }
                        或 iframe URL 引导：  <SANDBOX_URL>?draft=<encodeURIComponent(JSON.stringify(def))>
Cocos → 宿主(编辑器):   { type: '10s.playtestResult', won: boolean, steps?: number }
```
- `def` 必须是合法 `LevelDef`（沙箱内做最小 shape 校验）。
- `won === true` = **作者亲测通关**，是解锁"投稿/导出为成品"的客户端信号。
- **时序（硬要求）**：iframe 里的 Cocos 构建启动需要时间。托管 sandbox 必须在消息监听器挂好后向父页面发送 `{ type:'10s.sandboxReady' }`；编辑器只在收到该握手后投递草稿。超时进入可重试错误态，禁止向未就绪构建盲投或退回 URL 草稿。
- 安全：正式上线时 Cocos 侧应校验 `postMessage` 来源 origin 白名单；编辑器侧校验回传 origin。

### 5c. 网格常量（放 `packages/schema/src/grid.ts`；渲染/吸附用）

```
COLS = 50, ROWS = 26, CELL = 25.6(px, = 1280/50)
ORIGIN_X = -640, ORIGIN_Y = -360   // Cocos 世界系，左下角
0.5 格吸附：snap = Math.round(v * 2) / 2
```
> 编辑器 Canvas 可用自己的像素坐标，只要**保存回 LevelDef 的 col/row/tier 语义一致**即可（旧 `app.js` 已有 `canvasPoint/yFromRow/rectFor/snapHalf`，直接移植）。

### 5d. 道具调色板 + 锁定占位 + 承载规则（从旧 `app.js` TOOLS 移植）

| id | 标签 | sprite | 锁定 w×h | 归属 | 需承载面 | 备注 |
|---|---|---|---|---|---|---|
| spawn | 出生点 | hero | 2×3 | 单例 | 是 | 唯一 |
| key | 钥匙 | key | 1×2 | 单例 | 是 | 唯一 |
| door | 出口门 | door_closed | 2×3 | 单例 | 是 | 唯一，避让左下控件区 |
| bomb | 炸弹 | bomb | 2×2 | 单例 | 是 | |
| box | 箱子 | box | 2×2(可堆叠 h) | `boxes[]` | 是 | |
| spike | 尖刺 | spikes | 2×2 | `spikes[]` | 是 | 致命带 |
| wall | 可破坏墙 | tile_cracked | 3×3 | `walls[]` | 是 | 炸弹可炸 |
| stone | 石块 | tile_block | 2×2 | `stones[]` | 是 | 可爬 |
| rig | 压力板+升降台 | pressure_plate/lift | plate 2×1 / lift 3×1 | `rigs[]` | 是 | **≤3 组**，自动配色 `#46E5F2`/`#FFB23E`/第3色 |
| platform | 平台板(二层/高台) | tile_platform_thin | 3×1.5 | `ledges[]`/`tier2Tiles[]` | 地形 | |
| ground | 一层地块 | tile_block | 3×3 | `ground[]` | 地形 | |

- **硬约束**：同类道具尺寸跨关统一（位置可 0.5 格，尺寸不可改）。
- **校验（承载/悬空）**：需承载面的道具必须落在有效表面（地面/二层/高台/石块顶/箱顶/升降台面）；悬空 → **红框 + 阻止试玩/导出**。逻辑直接移植旧 `app.js` 的 `hasSupport/supportFromTerrain/stackSupportSurfaces/findPlacementSupport`，提炼进 `packages/schema/src/validate.ts` 复用。
- **存在性校验**：恰好 1 个 spawn、1 个 key、1 个 door；rig ≤ 3。
- **坑 `pits`**：地形裁切，不进"加道具"面板（旧 app.js 已按此处理）。

### 5e. 贴图来源

```
img.src = `${SPRITE_BASE_URL}/${name}.png`   // 名字见上表 sprite 列
```
`SPRITE_BASE_URL` 指向**托管的美术端点**（游戏库/CDN 提供），仓库内无 PNG。断连时降级为占位框 + 名字。

---

## 6. 里程碑（执行顺序，每个都可独立验收）

- **M0 · 脚手架**：monorepo（pnpm workspaces）、`tsconfig.base`、`.gitignore`、`LICENSE`(MIT/Apache)、`README`(引流 + 不含美术声明)、`CONTRIBUTING`。CI stub（lint + typecheck）。
- **M1 · `packages/schema`**：`levelDef.ts`(§5a) + `validate.ts`(§5d 提炼) + `playtest.ts`(§5b 类型) + `grid.ts`(§5c)。编译出 JS + d.ts，单测覆盖校验函数。
- **M2 · `packages/editor` 移植**：把旧 `public/{app.js,index.html,styles.css}` 移入，改依赖 `@10s/schema`（**删除自带的承载/校验/schema 副本，统一走 schema 包**）；**移除所有写 `LevelDef.ts` 的 `/api/*` 调用**（`create/delete/levels`）→ 改为本地草稿（localStorage）+ 打开/新建/克隆在内存中管理。`SPRITE_BASE_URL` 走 config。跑起来能作图。
- **M3 · 试玩内嵌**：`playtestEmbed.ts` —— "试玩"按钮打开内嵌 `<iframe src=SANDBOX_URL>`，按 §5b 把当前草稿传进去；收到 `10s.playtestResult`。**`won:true` 才解锁"导出为成品/投稿"**。用 §5b-A(URL) 先跑通，再切 §5b-B(握手)。
- **M4 · 导出/投稿**：`exportSubmit.ts` —— 导出 `LevelEnvelope` JSON（含 `author` 占位）到文件/剪贴板；"投稿"按 §8 打到后端 `API_BASE_URL`（后端未就绪时 stub：本地存/mock）。
- **M5 · 示例 + 文档**：`examples/` 放 2–3 个示例关卡（用游戏 `tools/export-levels.mts` 产物挑选，教学向，非全部商业关卡）；`docs/LEVEL_FORMAT.md` 写格式说明；README 完善引流。
- **M6 · 开源卫生 + 发布**：核对无 PNG/secret/引擎源码进库；config 面齐全；打 tag、发首个公开版本；GitHub 上 README 指向官网试玩。

---

## 7. 配置面（`packages/editor/src/config.ts`，全部可注入）

```ts
export const CONFIG = {
  SPRITE_BASE_URL: import.meta.env?.VITE_SPRITE_BASE_URL ?? '/sprites',      // 托管美术端点
  SANDBOX_URL:     import.meta.env?.VITE_SANDBOX_URL ?? 'https://play.<域名>/sandbox/', // 托管的 Cocos web 构建
  API_BASE_URL:    import.meta.env?.VITE_API_BASE_URL ?? '',                // 私有后端；空=投稿走本地 stub
};
```
- 本地开发可临时指向 dev：sprites 指旧生成器的 `/sprites`（它从游戏美术现取）；SANDBOX 指本地跑起来的 Cocos web 预览。

---

## 8. 后端契约（未来私有库；编辑器现在按此 stub）

- **鉴权**：GitHub OAuth（后端持 client secret）。前端拿到会话后带上。
- **接口（草案）**：
  - `POST /api/submissions` body: `LevelEnvelope + { playtest: { won, steps } }` → 入待审队列。
  - `GET /api/plaza?sort=hot|new` → 已过审投稿列表（供广场试玩）。
  - `POST /api/submissions/:id/vote` → 投票（限流/防刷）。
  - `POST /api/admin/adopt/:id`（管理员）→ 采纳：生成正式关卡 JSON + 更新游戏 CDN manifest（复用游戏库热更管线）。
- **防作弊（后续增强）**：投稿可带**作者输入序列**，后端用同一确定性引擎复算确认 `won`。MVP 先信客户端 `won`。
- **内容安全**：投稿先审后发（人工或第三方内容安全 API），再进广场。

---

## 9. 开源边界守则（硬规则，M6 核对）

- 仓库**永不提交**：美术 PNG、Cocos 引擎源码、完整商业关卡、任何 secret / OAuth client secret / DB 凭据。
- 美术与沙箱构建**运行时从托管 URL 取**（可配置 base）。
- `LICENSE`：代码 MIT 或 Apache-2.0；README 明确"**不含游戏美术资源；美术版权所有、禁止商用**"。
- 后端**审核/防作弊逻辑放私有后端库**，公开编辑器只见 API。

---

## 10. 需要在**游戏私有库**协调的小改动（跨库）

1. **沙箱 bootstrap**：`PlaytestBridge.init()` 必须随 sandbox 首发场景执行，并在 Web 内嵌环境发 `{ type:'10s.sandboxReady' }`；不能依赖用户先经过主菜单。
2. **托管沙箱构建**：游戏库出 `web-mobile` 构建并部署到 `SANDBOX_URL`；允许官网编辑器与约定 localhost origin iframe 嵌入，消息接收端校验同一 origin allowlist。
3. **托管 sprites**：把 `assets/resources/showcase/sprites` 以 `<name>.png` 形式暴露到 `SPRITE_BASE_URL`（公开可读；不改变"不把美术以开源许可授权"的立场）。
4. **schema 同步**：游戏 `LevelDef.ts` 与 `packages/schema` 保持一致（游戏 import 该包，或加 CI diff 校验）。

---

## 11. 验证（端到端）

- **构建**：`pnpm i && pnpm -r build` 通过；`packages/editor` 本地 dev server 能作图。
- **校验**：悬空道具红框、无法试玩；修正后可试玩；缺 spawn/key/door 时拦截。
- **试玩闭环**：编辑器内嵌沙箱 → 传草稿 → 玩 → 收 `10s.playtestResult{won:true}` → 解锁导出/投稿。
- **导出**：得到合法 `LevelEnvelope` JSON（含 `author` 占位），可被游戏阶段 1 远程加载正常游玩且回放一致。
- **开源边界**：`git ls-files | grep -iE '\.png$|secret|client_secret'` 为空；仓库可独立 clone 运行（sprites/sandbox 走托管 URL）。
- **schema 不漂移**：与游戏 `LevelDef` 一致。

---

## 附：新会话开工提示

1. 先读本文件全部。
2. 关联私有库只读参考：游戏 `<game-repo>`（`LevelDef.ts`、`editor/PlaytestBridge.ts`、`Grid.ts`、`tools/export-levels.mts`）；旧生成器 `<local-generator>`（`public/app.js` 移植源）。
3. 按 M0→M6 推进，每个里程碑跑 §11 对应验收。
4. 跨库改动（§10）需在游戏库那侧做，别在本库尝试改游戏。
