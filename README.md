# Windows 桌面 Todo

一个面向 Windows 10/11 的本地 Todo 桌面组件。查看模式尝试绑定到 WorkerW 桌面层，普通应用窗口会覆盖它；通过 `Ctrl+Alt+T` 或系统托盘进入编辑模式后，窗口临时脱离桌面层并获得焦点。

## 第一版范围

- Today：今天及逾期任务。
- Scheduled：未来有日期的任务。
- All：全部任务。
- 新增、编辑、日期、完成/恢复、删除撤销、拖动排序和搜索。
- SF Pro 字体与 Windows 中文字体 fallback。
- 托盘、全局快捷键、WorkerW 降级状态。
- 本地 JSON 持久化、备份、revision 冲突保护和文件级锁。
- 普通数据模式和便携路径解析。

不包含账号、云同步、自定义列表、Flagged 或置顶模式。

## 开发运行

要求 Node.js 20。

```powershell
npm install
npm run dev
```

应用启动后默认处于桌面查看模式。按 `Ctrl+Alt+T`，或点击系统托盘图标进入编辑模式。

## 验证

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

## 数据位置

- 普通模式：Electron 当前用户应用数据目录下的 `state.json`。
- 便携模式：通过 `--portable`、程序根目录 `portable.flag` 或 `bootstrap.json` 启用，数据写入 `<appRoot>/portable-data/`。
- 便携目录不可写时：回退到系统应用数据目录，并在设置状态中显示原因。

第一版不生成正式便携包，但便携路径和故障降级已经实现并有自动化测试。

## 已知边界

- WorkerW 依赖 Windows Explorer 的内部桌面窗口结构。绑定失败时应用仍可使用，但只能尽力置底，并会显示降级状态。
- 移动盘运行中被拔出时，内存中尚未确认的变更可能无法保存；应用不会静默报告成功。
- 开机启动和普通/便携数据迁移 UI 预留到后续发布里程碑。

详细需求和设计分别见 [PRD](docs/PRD.md) 与 [第一版设计](docs/DESIGN.md)。
