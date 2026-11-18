<p align="center">
  <img src="assets/icon.svg" width="120" alt="rextex 图标">
</p>

<h1 align="center">rextex</h1>

<p align="center">
  在 <a href="https://www.superlogical.com/rex/docs">Rex</a> 终端面板里把 LaTeX 公式显示成真正排版好的数学公式。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="许可证：MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen" alt="Node.js 18 以上">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey" alt="平台：macOS 和 Linux">
</p>

<p align="center">
  <a href="README.md">English</a> · 中文
</p>

<p align="center">
  <img src="assets/demo.gif" width="860" alt="Rex 面板录屏：打出带 LaTeX 源码的文字，随后公式被原地画出，并跟随新打出的内容">
</p>

终端里的公式通常只是一串源码，比如 `$\frac{n(n+1)}{2}$`。rextex 读取面板屏幕上的文字，找出其中的公式，用 MathJax 排版成图片，直接画在源码所在的位置上。不需要安装 TeX。

> [!NOTE]
> rextex 是非官方插件，与 Superlogical 无关。Rex 仍在测试阶段，接口可能变化。

## 功能

| | |
| --- | --- |
| **原地渲染** | 公式直接画在它自己的源码上面，就在原来的面板里，随屏幕内容实时更新。 |
| **公式面板** | 在另一个面板里把公式列出来放大看，可以滚动、缩放、复制。 |
| **文件** | 跟随一个 `.tex` 或 `.md` 文件，保存后公式自动刷新。 |
| **写作 skill** | 一个 Claude Code skill，让 agent 排公式时留出足够的行数。 |

## 目录

- [安装](#安装)
- [使用](#使用)
- [能识别什么](#能识别什么)
- [配置](#配置)
- [限制](#限制)
- [开发](#开发)
- [致谢与许可](#致谢与许可)

## 安装

需要 Node.js 18 以上，以及 macOS / Linux 上的 Rex。

```sh
git clone https://github.com/shinmohuang/rextex.git
cd rextex
./install.sh                 # 安装，快捷键 cmd+shift+m
./install.sh --key cmd+e     # 换一个快捷键
./install.sh --no-config     # 不改 init.lua，自己手动加
./install.sh --uninstall     # 卸载
```

<details>
<summary>安装脚本改了什么</summary>

- 在 `~/.local/bin/rextex` 写一个启动脚本。
- 把 `rex/rextex.lua` 链接到 `~/.config/rex/rextex.lua`。
- 在 `~/.config/rex/init.lua` 末尾加一段带标记的配置，原文件备份为 `init.lua.rextex-backup`。
- 如果有 `~/.claude`，把写作 skill 链接到 `~/.claude/skills/rextex-math`。它告诉 Claude Code 怎样排公式源码，比如独立公式分三行写、前后各空一行，这样原地渲染才有足够的行数。新开的对话才会加载。

</details>

> [!TIP]
> 移动了本目录或换了 Node 版本后，重新运行一次 `./install.sh`。

## 使用

### 原地渲染

聚焦到有公式的面板，按 `cmd+shift+m`，或在命令面板里搜 “LaTeX: Render Formulas in Place”。公式会直接画在它自己的源码上面，随屏幕内容实时更新；再按一次恢复显示源码。

- 行内公式只占原来那一行；独占一行的公式会借用上下的空行，所以能画得大一些。
- 放不下的公式（比如一行里的大分式）、没写完或有语法错误的公式保持源码不动。
- 颜色取自终端主题，第一次使用时会闪一下小分屏来测量；换了主题后在任意面板运行 `rextex theme` 重新测量。如果公式周围仍有一圈淡淡的方框，说明 Rex 实际画出的底色和它报告的不一样，用 `rextex theme --bg '#RRGGBB'` 手动指定。

### 公式面板

命令面板里搜 “LaTeX: Show Formulas in This Pane”，右侧打开一个面板，把公式列出来并画得更大。想绑定按键就在配置里加 `preview_key`。

公式面板里的按键：

| 键 | 作用 |
| --- | --- |
| `j` / `k`、方向键、鼠标滚轮 | 滚动 |
| 空格 / `b`，`d` / `u` | 翻页 / 半页 |
| `g` / `G` | 顶部 / 底部（在底部时自动跟随新公式） |
| `+` / `-` / `0` | 放大 / 缩小 / 还原 |
| `y` | 复制最上面那条公式的 LaTeX 源码 |
| `c` | 清空列表 |
| `q` | 退出 |

跟随另一个面板时，看过的公式会一直留在列表里，即使它已经滚出屏幕。

### 命令行

```sh
rextex inline --block BLOCK           # 在某个面板里原地渲染（--on / --off）
rextex view paper.tex                 # 在当前面板里跟随一个文件
rextex view --block BLOCK             # 跟随一个面板
rextex show '\int_0^1 x^2\,dx'        # 直接画在当前终端里
rextex list paper.tex                 # 只列出找到的公式（纯文本）
```

## 能识别什么

`$…$`、`$$…$$`、`\(…\)`、`\[…\]`，以及 `equation`、`align`、`gather`、`multline`、`cases`、各种 `matrix` 等环境。被终端硬换行截断的公式会自动拼回去。

`$…$` 在 shell 文本和价格里也会出现，所以只有内容看起来像数学时才算公式，例如 `$5 and $10` 和 `"$HOME"` 会被跳过。

## 配置

安装脚本会在 `init.lua` 里加上这一行。想改默认值就多传几个选项：

```lua
require("rextex").setup{ key = "cmd+shift+m" }
```

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `key` | 无 | 原地渲染的按键。不写则只出现在命令面板里。 |
| `preview_key` | 无 | 公式面板的按键。 |
| `inline_zoom` | `1` | 原地渲染时公式的大小。 |
| `where` | `"right"` | 公式面板打开的位置：`"right"`、`"below"` 或 `"float"`。 |
| `ratio` | `0.4` | 公式面板占的比例。 |
| `zoom` | `1.3` | 公式面板里公式相对文字的大小。 |
| `bin` | `~/.local/bin/rextex` | `rextex` 命令的路径。 |

## 限制

- 需要终端支持 kitty 图形协议（Rex 支持）。
- 原地渲染不能移动文字。公式只能用源码占的那几行，独立公式再加上相邻的空行。`rextex-math` skill 就是为了让 Claude Code 留够地方。
- 原地渲染要求 rextex 装在会话所在的那台机器上（远程主机要在那边再装一次）。
- 只渲染数学公式，不渲染整篇文档；写在导言区（公式之外）的 `\newcommand` 自定义宏读不到，用到它们的公式会报错。
- 在公式面板里，语法错误的公式显示错误信息，而不是图片。
- 如果程序把 `\[` 显示成了 `[`（有些 Markdown 渲染器会吃掉反斜杠），屏幕上就没有可识别的定界符了。

## 开发

```sh
npm install
npm test
```

## 致谢与许可

原地渲染“直接写面板 tty 设备”的做法来自 [liambern/herdr-math](https://github.com/liambern/herdr-math)。公式排版用 [MathJax](https://www.mathjax.org)，栅格化用 [resvg-js](https://github.com/yisibl/resvg-js)。

[MIT](LICENSE)
