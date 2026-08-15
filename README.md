# Frogger

Four stock logs on a river. SNAP, META, GOOG, and NVDA by default (editable in settings).

- **5-minute rounds** with a countdown bar under the scoreboard (stop anytime to save)
- Enter a **player name**; it persists locally and is saved with each score
- Scores post to **Supabase** (`public.scores`) when `config.js` has your project URL + anon key
- Jump onto a log to invest **$100,000**; jump ashore to cash out
- Synthetic quote walk + NYSE open/closed badge

## Open

https://eliotsjunkmail.github.io/listo/

## Supabase setup

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor.
3. Put the project URL and anon key into [`config.js`](config.js):

```js
window.FROGGER_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_ANON_KEY",
};
```
