const STORAGE_KEY = "listy-todos-v1";

/** @typedef {{ id: string, text: string, done: boolean, createdAt: number }} Todo */

const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const listEl = document.getElementById("todo-list");
const countLabel = document.getElementById("count-label");
const clearDoneBtn = document.getElementById("clear-done");
const filterButtons = document.querySelectorAll(".filter");

/** @type {Todo[]} */
let todos = loadTodos();
/** @type {"all" | "active" | "done"} */
let filter = "all";

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  todos = [
    {
      id: crypto.randomUUID(),
      text,
      done: false,
      createdAt: Date.now(),
    },
    ...todos,
  ];
  input.value = "";
  persist();
  render();
  input.focus();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    filter = /** @type {"all" | "active" | "done"} */ (button.dataset.filter);
    filterButtons.forEach((btn) => {
      const active = btn === button;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    render();
  });
});

clearDoneBtn.addEventListener("click", () => {
  todos = todos.filter((todo) => !todo.done);
  persist();
  render();
});

listEl.addEventListener("change", (event) => {
  const target = /** @type {HTMLInputElement} */ (event.target);
  if (!target.matches(".toggle")) return;
  const id = target.closest(".todo-item")?.dataset.id;
  if (!id) return;
  setDone(id, target.checked);
});

listEl.addEventListener("click", (event) => {
  const target = /** @type {HTMLElement} */ (event.target);
  const item = target.closest(".todo-item");
  if (!item) return;

  const id = item.dataset.id;
  if (!id) return;

  if (target.closest(".btn-delete")) {
    item.classList.add("is-leaving");
    window.setTimeout(() => {
      todos = todos.filter((todo) => todo.id !== id);
      persist();
      render();
    }, 200);
    return;
  }

  if (target.closest(".toggle")) return;

  const todo = todos.find((entry) => entry.id === id);
  if (!todo) return;
  setDone(id, !todo.done);
});

/**
 * @param {string} id
 * @param {boolean} done
 */
function setDone(id, done) {
  todos = todos.map((todo) => (todo.id === id ? { ...todo, done } : todo));
  persist();
  render();
}

function loadTodos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.text === "string" &&
        typeof item.done === "boolean"
    );
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
}

function visibleTodos() {
  if (filter === "active") return todos.filter((todo) => !todo.done);
  if (filter === "done") return todos.filter((todo) => todo.done);
  return todos;
}

function render() {
  const visible = visibleTodos();
  const remaining = todos.filter((todo) => !todo.done).length;
  const completed = todos.length - remaining;

  countLabel.textContent =
    remaining === 1 ? "1 task left" : `${remaining} tasks left`;
  clearDoneBtn.hidden = completed === 0;

  if (visible.length === 0) {
    const message =
      todos.length === 0
        ? "Nothing here yet — add your first task."
        : filter === "done"
          ? "No completed tasks yet."
          : filter === "active"
            ? "All caught up."
            : "Nothing to show.";
    listEl.innerHTML = `<li class="empty">${message}</li>`;
    return;
  }

  listEl.innerHTML = visible
    .map(
      (todo) => `
      <li class="todo-item${todo.done ? " is-done" : ""}" data-id="${todo.id}">
        <input
          class="toggle"
          type="checkbox"
          ${todo.done ? "checked" : ""}
          aria-label="Mark “${escapeAttr(todo.text)}” as ${todo.done ? "active" : "done"}"
        />
        <p class="todo-text">${escapeHtml(todo.text)}</p>
        <button type="button" class="btn-delete" aria-label="Delete “${escapeAttr(todo.text)}”">
          Delete
        </button>
      </li>
    `
    )
    .join("");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

render();
input.focus();
