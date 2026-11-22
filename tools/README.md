# 他的主动消息（服务器定时推送）

这个 workflow 每 30 分钟看一眼，按概率从他的字卡池里抽一句话，发到微信（PushPlus），
并把这句话记进 `data/offline-messages.json`；你下次打开站点时，这些话会自己补进聊天里。

需要一次性配置：

1. 仓库 Settings → Secrets and variables → Actions → New repository secret
   - Name: `PUSHPLUS_TOKEN`
   - Value: 你在 pushplus.plus 拿到的 token
2. 手机上把字卡导出一次，把里面的字卡文本整理成 `data/push-cards.json`（字符串数组，一条一句）。
   也可以直接把整份备份 JSON 发给助手处理。

`data/push-config.json` 可以调：
- `name`：通知标题里显示的名字
- `chance`：每次检查时发送的概率（0~1）
- `hours`：允许发送的小时区间（北京时间）
