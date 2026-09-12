// Authored synthetic debugging histories. These are reproducible regression
// fixtures, NOT anonymized production sessions or human-rated quality data.
const cases = [
  ["electron", "Electron 白屏", "关闭硬件加速", "白屏仍然存在", "修正 preload 路径", "启动集成测试通过，页面内容正常渲染", ["Electron 白屏怎么修复", "启动页面一片空白", "preload 路径", "硬件加速关闭后有用吗"]],
  ["index", "搜索索引更新延迟", "每次查询全量扫描", "搜索仍卡顿，耗时 8 秒", "独立 Worker 监听目录并增量更新 SQLite", "新增会话后索引更新测试通过", ["索引更新延迟", "历史记录新增后搜不到", "Worker SQLite", "全量扫描最后采用了吗"]],
  ["csrf", "发布接口 403", "关闭 Origin 校验", "该方案被否定，会允许外部页面发请求", "携带同源 Origin 和 CSRF token", "合法请求返回 200，无 token 请求返回 403", ["发布接口 403", "分享按钮请求被拒绝", "CSRF token", "Origin 校验可以关闭吗"]],
  ["recovery", "重启后会话恢复丢失", "退出时才保存", "断电时保存钩子没有执行", "运行期间持续持久化会话清单", "模拟异常终止后恢复了测试会话", ["会话恢复丢失", "电脑断电之后怎么找回对话", "持久化会话清单", "退出保存为什么失败"]],
  ["watch", "ENOSPC 文件监听失败", "无限重试 watcher", "监听仍然报错 ENOSPC", "增加周期扫描作为监听失效的补漏", "禁用 watcher 后新增文件仍被周期扫描发现", ["ENOSPC", "文件监控坏了如何同步", "watcher 周期扫描", "无限重试文件监听有效吗"]],
  ["vector", "embedding 维度不匹配", "截断向量到较小维度", "相似度失真，方案已撤销", "按模型和服务地址隔离缓存并校验维度", "不同维度的向量被明确拒绝", ["embedding 维度不匹配", "更换向量模型后搜索异常", "校验维度", "截断向量方案为何撤销"]],
  ["port", "EADDRINUSE 4321", "自动换成随机端口", "旧页面仍访问原端口，未解决", "停止旧的 4321 服务再启动新应用", "4321 健康检查返回新版本", ["EADDRINUSE", "启动时端口被旧程序占用", "4321 健康检查", "随机端口解决了吗"]],
  ["xss", "历史 Markdown XSS", "只移除 script 标签", "带事件属性的图片仍可注入", "使用 HTML 白名单清洗并过滤危险 URL", "事件属性和 javascript URL 攻击测试通过", ["Markdown XSS", "历史消息里的恶意图片如何处理", "危险 URL", "只删除 script 标签安全吗"]],
  ["cancel", "切换问题后显示旧答案", "仅清空输入框", "旧请求晚到后覆盖新答案", "AbortController 取消并校验请求序号", "乱序响应测试没有覆盖当前答案", ["旧答案覆盖", "连续提问时结果串了", "AbortController 请求序号", "清空输入框能避免竞态吗"]],
  ["duplicate", "重复上报导致 Token 翻倍", "客户端延迟重试", "网络重试仍然重复累计", "服务端唯一事件键配合 ON CONFLICT 去重", "同一批数据提交三次，累计值保持不变", ["Token 翻倍", "网络重试之后用量重复计算", "ON CONFLICT", "客户端延迟重试能去重吗"]],
];
export const sessions = cases.map(([id, title]) => ({ ref: `claude:rag-fixture-${id}`, title, engine: "claude", cwd: `/fixtures/${id}`, mtime: "2026-08-21T12:00:00Z" }));
export const snapshots = new Map(cases.map(([id, title, attempt, failure, solution, verification]) => {
  const ref = `claude:rag-fixture-${id}`;
  return [ref, { ref, title, turns: [
    { role: "user", turn: 1, text: `请排查：${title}`, timestamp: "2026-08-21T10:00:00Z" },
    { role: "assistant", turn: 2, text: `先尝试${attempt}。` },
    { kind: "tool", role: "tool", turn: 3, name: "test", text: failure },
    { role: "user", turn: 4, text: "这个尝试没有解决，继续检查。" },
    { role: "assistant", turn: 5, text: `最终修复：${solution}。` },
    { kind: "tool", role: "tool", turn: 6, name: "test", text: verification, timestamp: "2026-08-21T11:00:00Z" },
  ] }];
}));
export const questions = cases.flatMap(([id, , , , solution, , queries]) => queries.map((query, i) => ({ id: `${id}-${i}`, query, expectedRef: `claude:rag-fixture-${id}`, expectedText: solution, answerable: true })));
for (const [i, query] of ["火星基地氧气库存", "公司今年营业收入", "我的银行卡余额", "哪个同事明天请假", "最喜欢哪首钢琴曲", "服务器管理员的生日", "昨天晚饭热量", "冰岛火山喷发日期", "宠物疫苗预约时间", "小区物业费账单"].entries()) questions.push({ id: `unknown-${i}`, query, expectedRef: null, expectedText: null, answerable: false });
export const fixtureDeps = { listSessions: async () => sessions, loadSnapshot: async (ref) => snapshots.get(ref) };
