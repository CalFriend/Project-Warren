# Project Warren

Project Warren 跟踪 14 家港股公司和 2 只 ETF。早报回答「今天有哪些变化值得看」，盘中检查经过复核的价格提醒规则，晚审用原始披露验证「这项资产赚到的钱，和当初估算的一样吗」。

日常服务运行在 Google Apps Script，研究输入、收盘记录和审计档保存在 Google Drive，早报由 Gmail 发送。这个仓库保存程序、研究方法和可复算的样例。下载到电脑即可试跑，电脑关机也不影响已有的 Google 定时任务。

## 在新电脑上试跑

安装 [Node.js](https://nodejs.org/) 22 或更高版本。在 GitHub 选择 **Code → Download ZIP** 并解压，也可以用 Git 克隆。打开含 `package.json` 的目录，在终端运行以下两行。演示使用合成数据，无需安装依赖、登录账户或连接行情服务。

```sh
node tools/demo-morning.cjs
node tools/demo.cjs
```

第一行演示同一份早报模板如何处理有效资料和过期资料。第二行回放两个报告期，先封存 110 百万港元的经营现金预测，再读入示例实绩 120 百万港元，并与「维持上期 100」的对照预测比较。看到预测误差 10、对照误差 20，即已跑通晚审。示例日期、数字和价格只用于验证程序。

运行完整测试和生成 Apps Script 文件可用以下命令。两个命令均可离线运行。

```sh
node --test
node tools/build.cjs
```

## 从研究到提醒

| 环节 | 做什么 | 主要程序或资料 |
| --- | --- | --- |
| 早报 | 港股交易日 09:30 发送，研究截止 09:15。核验日期、16 只证券的覆盖、昨日收盘和资讯来源。主稿失效时检查同日备用稿，两份都不合格时发资料待补通知 | `cloud/WarrenCore.gs`、`WarrenNews.gs`、`WarrenApp.gs` |
| 盘中 | 接入富途只读行情。仅在行情及时、研究规则有效、风险机制允许的情况下检查提醒，记录发送状态并去重 | `cloud/WarrenCore.gs`、`WarrenApp.gs` |
| 晚审 | 香港时间 21:30 起核验逐项资产现金流和事前预测。读取两份当晚输入、上一份封存结果及相关收盘记录，然后保存可复核的报告 | `cloud/WarrenEveningCore.gs`、`WarrenEveningApp.gs` |
| 判断校准 | 计算股东可得现金、反推市场隐含增长、检验周期情景。保留预测失败记录，将候选修正与原模型、持平预测作后续对照 | `cloud/WarrenLearning.gs`、[晚审研究规则](docs/evening-research.md) |
| 共用设置 | 证券及行业清单供三个环节共用；账户邮箱、Drive 目录等从 Google 项目设置读入 | `cloud/WarrenUniverse.gs`、`WarrenConfig.gs` |

Google 上的定时处理负责读、验、存、发。每日研究任务还需要获取原始披露，撰写有截止时间的输入并放进 Drive。仅在新电脑运行演示或构建命令，不会建立新的研究任务或寄出邮件。

## 复算某个问题

- **逐资产核验**。运行 `node tools/evening-asset-audit.cjs input.json report.json --previous last-report.json`。首期可省去 `--previous`。命令执行经营事实与预测核验；演示和 Google 晚审另外执行学习计算。正式报告由 Google 读回输入、核对价格及封存指纹后生成。
- **港股市场历史**。`node research_hk/analyze.cjs --demo` 演示回撤及修复统计，`node research_hk/events.cjs --demo` 和 `node research_hk/presidents.cjs --demo` 演示事件窗口。计算使用截至 2026-11-13 的历史研究口径。可用 `--input` 带入自备数据，`--help` 查看格式。
- **个股历史估值**。`node tools/fundamental-models.cjs --demo` 使用合成收盘数据演示计算。`node tools/yuexiu-model.cjs --output yuexiu-scenario.json` 导出越秀交通基建当期历史模型，再加 `--check` 可核对文件。两者的模型假设都有历史时点，阅读输出时应查看日期。

## 在另一个 Google 账户单独部署

日常使用原 Google 服务的读者只需上面的试跑步骤。若希望另起一套服务，请在独立的 Apps Script 项目完成以下步骤。

1. 运行 `node tools/build.cjs`。将 `output/WarrenConfig.gs`、`output/Warren.gs`、`output/WarrenEvening.gs` 各复制一次到同一 V8 项目。共享文件包含证券清单和账户配置。也可用 `node tools/build.cjs dist` 自选输出目录。
2. 在项目设置的 Script Properties 填入 `WARREN_OWNER_EMAIL`（执行账号）和 `WARREN_RECIPIENT_EMAIL`（唯一收件人）。已有专用 Drive 目录时填 `WARREN_ROOT` 的文件夹 ID。可选 `WARREN_SENDER_NAME`、`WARREN_REPLY_TO`、`WARREN_RESEARCH_URL`、`WARREN_PLAN_URL`。
3. 运行 `warrenInitialize`。未指定目录时它会建立项目文件夹。初始化产生待研究模板。准备当日研究稿和原始来源，运行 `warrenPreview` / `warrenAuditMorning` 查看实际核验状态。可从合成场景了解研究结构。
4. 要启用邮件和行情，依次执行 `warrenTestEmail`、`warrenAuthorizeFutu`，从测试邮箱完成富途 `quote:read` 授权，再执行 `warrenVerifyQuotes`、`warrenVerifyCloses` 检查实际结果。确认收件、行情与研究均符合预期后，运行 `warrenStart`。这一步才开启定时投递。
5. 安排独立的研究输入生产者，每晚把 `YYYY-MM-DD-evening-learning-input.json` 和 `YYYY-MM-DD-evening-asset-input.json` 写进同一 Drive 目录。执行 `warrenEveningInstall` 安装晚审时钟，用 `warrenEveningStatus` 查看最近一次结果。缺资料时会重查并留下待补状态。[晚审研究规则](docs/evening-research.md)

本仓库的可选模型连通测试支持自行提供 `WarrenModelAdapter.call` 和 `WARREN_MODEL_NAME`。本地演示、现金流核验和规则计算均使用仓库内的确定性计算逻辑。
