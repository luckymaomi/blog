# Talk

本地编辑 Markdown，构建后用 GitHub Pages 发布。

仓库：https://github.com/luckymaomi/talk  
默认分支：`master`

## 启动管理端

```bash
python start_admin.py
```

打开 http://localhost:3456 ：左侧列表，右侧编辑 + 预览，停笔约 3 秒自动保存。

## 构建公开站

```bash
python build.py --force
```

产物在 `dist/`。push 到 `master` 后由 Actions 部署 Pages。

## 文章命名

```text
posts/YYYY-MM-DD-slug.md
```

列表按文件名中的年份分组。无草稿/发布流程，保存即内容。

## 推送

`config.json` 里 `push.remote` / `push.branch` 目前留空，未配置不会执行推送。
