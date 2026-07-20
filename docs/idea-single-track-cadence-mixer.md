# Single Track Cadence Mixer Idea

第一步应该完全砍掉云端规划器，先做一个纯前端 Web Audio MVP。目标不是“智能编排”，而是先把音频链路跑通：

上传歌曲 -> 分析 BPM -> 用户设置目标 BPM -> 生成节拍器 click -> 与原曲混音 -> 导出音频

这个版本如果能稳定跑通，后面接入 GPT-5.6 Terra 只是把“用户手动设 BPM”升级成“GPT-5.6 Terra 自动给处理方案”。

## MVP 目标定义

项目第一阶段叫：

**Single Track Cadence Mixer**

核心功能：

1. input 一首歌曲
2. 分析歌曲 BPM
3. 用户设置目标 BPM，例如 180 / 185 / 190
4. 生成目标 BPM 的节拍器
5. 与歌曲混音
6. 导出 WAV

先不要做：

- GPT-5.6 Terra
- 多曲编排
- 跑步计划
- 自动选歌
- 变速不变调
- MP3 导出
- beat phase 自动对齐
- 云端上传

第一版越干净越好。

## 技术栈建议

前端：

- Vite
- React
- TypeScript
- Web Audio API

BPM 分析：

第一版可以有两个选择。

### 方案 A：先用简单 BPM detector

优点：

- 实现快
- 依赖少
- 黑客松 demo 容易控制

缺点：

- 准确率一般
- 对复杂音乐不稳定

### 方案 B：用 Essentia.js

优点：

- 音频分析能力更强
- 后面可以扩展 beat confidence / tempo stability

缺点：

- WASM 加载复杂
- 初期调试成本更高

建议：

第一版先做简单 BPM detector + 手动修正 BPM；第二版再替换成 Essentia.js。

因为对 MVP 来说，手动修正 BPM 是必须有的。即使算法不准，用户也能继续走完整流程。

## 第一版页面设计

页面做 5 块：

1. Upload
2. Analyze
3. Target BPM
4. Mix Preview
5. Export

UI 草图：

```text
[Upload Audio File]
File: song.mp3
Duration: 03:42
Detected BPM: 91.8
Use as:
( ) 91.8
(*) 183.6
Manual BPM: [183.6]
Target BPM:
[180] [185] [190] [Custom: ___]
Metronome:
Click style: [Soft] [Sharp] [Wood]
Volume: [----|-----] 35%
Accent: [None] [Every 4 beats]
Offset: [0 ms]
[Preview 30 sec]
[Generate Full Mix]
[Export WAV]
```

## 关键产品判断

### 1. detected BPM 不等于 running cadence

这是第一版必须处理的点。

比如歌曲检测到：

```text
91.8 BPM
```

跑步时可能应该当作：

```text
183.6 cadence
```

所以分析完 BPM 后，要显示候选：

- detectedBpm / 2
- detectedBpm
- detectedBpm * 2

例如：

- 45.9
- 91.8
- 183.6

然后让用户选择：

```text
Use source BPM as: 183.6
Target BPM: 180
```

第一版不一定要真的变速。可以先做：

- 原曲保持不变
- 节拍器按 target BPM 播放

### 2. 第一版先不做歌曲变速

原需求里有：

```text
将我的音频改成目标 BPM
```

但第一步建议先暂缓。原因很现实：变速不变调是整个项目里最容易翻车的 DSP 部分。

第一版先实现：

```text
song original speed + metronome overlay
```

也就是：

- 原曲不改
- 只加 180 BPM click

这已经能解决一半核心需求：你可以拿自己的歌加跑步节拍器。

第二版再做小幅安全变速。

## 阶段计划

### Phase 0：项目初始化

目标：网页能跑起来。

任务：

- 创建 Vite React TS 项目
- 做基本页面布局
- 实现文件上传 input
- 显示文件名和基本状态

目录建议：

```text
src/
  App.tsx
  audio/
    decodeAudio.ts
    analyzeBpm.ts
    bpmCandidates.ts
    metronome.ts
    mix.ts
    exportWav.ts
  components/
    UploadPanel.tsx
    BpmPanel.tsx
    MetronomePanel.tsx
    PreviewPanel.tsx
    ExportPanel.tsx
```

验收标准：

- 用户可以上传 mp3 / wav / m4a
- 页面显示文件名

### Phase 1：音频解码与播放

目标：上传音频后，可以在浏览器播放。

任务：

- 使用 FileReader 读取 ArrayBuffer
- 使用 AudioContext.decodeAudioData 解码
- 得到 AudioBuffer
- 显示 duration / sampleRate / channels
- 实现原曲播放 / 暂停

核心类型：

```ts
type LoadedAudio = {
  fileName: string;
  arrayBuffer: ArrayBuffer;
  audioBuffer: AudioBuffer;
  durationSec: number;
  sampleRate: number;
  numberOfChannels: number;
};
```

验收标准：

- 上传歌曲后能播放原曲
- 能显示歌曲长度

### Phase 2：BPM 分析

目标：初步识别 BPM，并允许手动修正。

任务：

- 将 AudioBuffer 转 mono
- 降采样到分析用 sample rate，例如 11025Hz
- 做 onset / energy envelope 分析
- 估计 BPM
- 生成 BPM candidates
- 显示 detected BPM
- 允许用户手动输入 source BPM

第一版 BPM 检测不用追求完美。至少要做到：

- 检测结果能大致可用
- 用户可以手动修正

BPM candidates：

```ts
function getBpmCandidates(bpm: number) {
  return [bpm / 2, bpm, bpm * 2].filter((v) => v >= 40 && v <= 240);
}
```

验收标准：

- 上传歌曲后显示 detected BPM
- 显示候选 BPM
- 用户可以选择/输入 source BPM

### Phase 3：目标 BPM 设置

目标：用户可以设置跑步目标节拍。

默认值：

- 180
- 185
- 190
- Custom

状态设计：

```ts
type BpmSettings = {
  detectedBpm: number | null;
  selectedSourceBpm: number | null;
  targetBpm: number;
};
```

第一版里 selectedSourceBpm 只是用于显示“这首歌和目标节奏差多少”，不一定参与变速。

显示信息：

```text
Source BPM: 183.6
Target BPM: 180
Difference: -3.6 BPM
Suggested: no tempo change, metronome only
```

验收标准：

- 用户能选择 180 / 185 / 190
- 能看到 source BPM 和 target BPM 差值

### Phase 4：生成节拍器 click

目标：生成一条目标 BPM 的 click 音轨。

参数：

```ts
type MetronomeSettings = {
  targetBpm: number;
  volume: number; // 0-1
  clickStyle: "soft" | "sharp" | "wood";
  accentEvery: 0 | 2 | 4 | 8;
  offsetMs: number;
};
```

第一版 click 生成逻辑：

```text
beatIntervalSec = 60 / targetBpm
从 0 秒开始，每 beatIntervalSec 生成一次 click
```

click 类型先做两个就够：

- sharp: 1500Hz sine beep
- soft: 高频短噪声

验收标准：

- 可以单独播放 180 BPM metronome
- 可以调音量
- 可以设置每 4 拍重音

### Phase 5：混音 preview

目标：把原曲和节拍器混在一起播放。

第一版不要直接导出，先做 preview。

流程：

```text
原曲 AudioBuffer + metronome Float32Array -> mixed AudioBuffer -> 播放
```

混音时要避免爆音：

```ts
mixedSample = songSample * songGain + clickSample * clickGain;
mixedSample = Math.max(-1, Math.min(1, mixedSample));
```

建议默认：

- songGain = 0.85
- clickGain = 0.35

UI：

- Song volume: 85%
- Click volume: 35%

验收标准：

- 点击 Preview 后，可以听到原曲 + click
- click 节奏随目标 BPM 改变

### Phase 6：导出 WAV

目标：把 mixed AudioBuffer 导出成 WAV 文件。

第一版只导出 WAV。不要碰 MP3。

原因：

- WAV 编码简单
- 浏览器端稳定
- 不用引入额外 encoder
- demo 不容易翻车

流程：

```text
AudioBuffer -> Float32 PCM -> Int16 PCM -> WAV Blob -> download
```

文件名：

```text
original-name_180bpm_mix.wav
```

验收标准：

- 点击 Export WAV
- 浏览器下载 wav 文件
- 下载后的文件可以正常播放

## 第一版数据流

```text
File input
  -> ArrayBuffer
  -> AudioContext.decodeAudioData
  -> AudioBuffer
  -> analyzeBpm(audioBuffer)
  -> detectedBpm + candidates
  -> targetBpm settings
  -> createMetronomeTrack(duration, targetBpm)
  -> mixAudio(originalBuffer, metronomeBuffer)
  -> exportWav(mixedBuffer)
```

## 第一版不要做的东西

不做云端规划，因为现在要先验证音频链路。

不做多曲。多曲会引入：

- 时长填充
- crossfade
- 歌曲选择
- energy normalization
- timeline

这些先不碰。

不做变速不变调。这是 P2/P3 以后再做的事。

第一版最多显示：

```text
To match target BPM, this song would need -2.0% tempo adjustment.
```

但不执行。

不做 beat phase alignment。

第一版用 stable cadence grid：

```text
click 从 0 秒开始按目标 BPM 固定生成
```

如果 click 和鼓点有点错位，先接受。跑步训练目的优先于音乐 remix。

## 推荐开发顺序

最稳顺序：

Day 1:

1. Vite React TS 初始化
2. 上传音频
3. decodeAudioData
4. 播放原曲
5. 显示 duration

Day 2:

1. 实现简单 BPM 检测
2. 显示 BPM candidates
3. 手动修正 BPM
4. target BPM 设置

Day 3:

1. 生成 metronome
2. 单独播放 metronome
3. 原曲 + click preview

Day 4:

1. WAV export
2. UI 整理
3. 测试 3-5 首歌

黑客松时间不够的话，优先级：

- P0 上传 + 播放
- P1 手动输入 source BPM / target BPM
- P2 生成 metronome
- P3 混音 preview
