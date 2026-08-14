# Listy

A simple browser to-do list app. Add tasks, mark them done, filter the list, and clear completed items. Everything is saved in `localStorage`.

## Open the app

The GitHub repo page only shows **code**, not the running app. Use one of these:

### Option A — GitHub Pages (best on phone)

1. Go to [Pages settings](https://github.com/eliotsjunkmail/listo/settings/pages)
2. **Source** → Deploy from a branch
3. Branch: `main` · Folder: `/ (root)` → Save
4. After about a minute, open: **https://eliotsjunkmail.github.io/listo/**

### Option B — On your computer

```bash
git clone https://github.com/eliotsjunkmail/listo.git
cd listo
npx --yes serve .
```

Open the URL it prints (usually `http://localhost:3000`), or just open `index.html` in a browser.

## Features

- Add, complete, and delete tasks
- Filter: All / Active / Done
- Clear completed
- Persists across reloads
