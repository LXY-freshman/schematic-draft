# Schematic Draft

Windows 本地离线运行的电路原理图编辑器。基于开源项目
[Analog Canvas](https://github.com/cascode-ai/analog-canvas)（cascode-ai，AGPL-3.0）改造：
去掉了所有联网功能，电路数据只存在这台电脑上。

## 目录内容

| 路径                                         | 说明                                                              |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `app\schematic-draft.exe`                    | 直接双击运行，推荐日常使用（整个 `app\` 文件夹可以随意移动/复制） |
| `Schematic Draft-0.9.2-win-x64-portable.exe` | 单文件便携版，功能相同；每次启动会先解压到临时目录，启动稍慢      |
| `source\`                                    | 完整源码（不含 node_modules），可自行审计和重新构建               |

首次运行如果 Windows SmartScreen 提示"未知发布者"，点"更多信息 → 仍要运行"即可，
程序没有做代码签名。

## 数据放在哪里

- **电路工程**：`文档\Schematic Draft\Projects\<id>\`
  - `circuit.icproj.json` —— 工程本体，就是编辑器"Export"出来的同一种文件，可以直接备份、拷贝、用 Git 管理
  - `meta.json` —— 名称、修订号、更新时间
  - `preview.svg` —— 工程列表里的缩略图
- **窗口大小、界面偏好、崩溃恢复副本**：`%APPDATA%\Schematic Draft\`

菜单 `File → Open Projects Folder` 会直接打开工程目录。
（菜单栏默认隐藏，按一下 `Alt` 键显示。）

## 安全保证

1. **没有任何网络请求**。编辑器从程序自带的文件加载，主进程在 Chromium 发起连接前就拦截并拒绝所有
   `http/https/ws` 请求，即使将来某个版本的编辑器代码试图联网也会失败。
2. **不开本地端口**。编辑器通过程序内部的 `app://` 协议加载，而不是本机 HTTP 服务，其他进程无法访问工程接口。
3. **无账号、无云同步、无遥测**。上游的"Cloud Projects"接口被本地文件存储替代，
   Gallery、登录、发布、使用统计、Agent 中继、在线仿真的入口全部移除。
4. **渲染进程沙箱化**，`contextIsolation` 开启，没有 Node 集成；导出文件走系统"另存为"对话框。
5. 剪贴板以外的浏览器权限请求（摄像头、定位、通知等）一律拒绝。

## 与在线版的差异

保留：原理图编辑、层次化设计、符号库、SPICE 导入/导出、SVG/PDF/PNG 导出、
`.icproj.json` 文件导入/导出、撤销/恢复、崩溃恢复。

去掉：Gallery 浏览与发布、账号登录、Cloud Projects（改为 Local Projects）、
AI Agent、在线仿真、时序仿真、Bug 反馈链接、使用统计。

## 重新构建

在 WSL（或任何 Linux/macOS）里，需要 Node ≥ 24 和 pnpm 11：

```bash
cd source
pnpm install
scripts/sync-to-windows.sh /mnt/d/AI/Claude/schematic-draft   # 全量构建并复制到这里
```

单独的步骤：

```bash
pnpm build                                        # 工作区各包
VITE_ICM_DESKTOP=enabled pnpm --filter @icm/editor build   # 桌面版编辑器
node apps/desktop/scripts/make-icons.mjs          # 图标
node apps/desktop/scripts/build.mjs               # 主进程打包
cd apps/desktop && ./node_modules/.bin/electron-builder --win portable --x64 --publish never
```

NSIS 安装包（`--win nsis`）在 Linux 上需要 Wine，因此这里只产出便携版和解压版；
在 Windows 上装好 Node/pnpm 后直接运行同样的命令即可得到安装包。

网络不通 GitHub 时，设置镜像：
`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`、
`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
（`sync-to-windows.sh` 已默认设置）。

桌面相关的改动都在 `apps/desktop/` 和 `apps/editor/src/` 里带 `DESKTOP_BUILD` 判断的少数几处，
方便以后合并上游更新。

## 许可

本程序是 Analog Canvas 的修改版本，遵循 GNU AGPL-3.0。`app\resources\` 下附带
`LICENSE.md` 与 `NOTICE.md`。自用无任何限制；若再分发，须连同源码一起并保留许可声明。
应用图标为本构建原创。
