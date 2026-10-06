import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };
const ROLE_LABELS = { admin: "管理员", worker: "操作工" };

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "请求失败");
  return data;
}

function pageFromHash() {
  return location.hash.replace(/^#\/?/, "").startsWith("rows") ? "rows" : "map";
}

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    me: { type: Object },
    page: { type: String },
    board: { type: Object },
    rowInfo: { type: Array },
    picked: { type: Object },
    ph: { type: String },
    err: { type: String },
    rows: { type: Array },
    edits: { type: Object },
    rowsErr: { type: String },
    savedRow: { type: Number },
    username: { type: String },
    password: { type: String },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    header.top { display: flex; align-items: center; gap: 16px; background: #3a2e22; color: #f3e9d8; padding: 10px 20px; }
    header.top .brand { font-weight: bold; font-size: 1.15em; }
    header.top nav a { color: #d8c7a8; text-decoration: none; padding: 6px 12px; border-radius: 6px; }
    header.top nav a.on { background: #6b543a; color: #fff; }
    header.top .who { margin-left: auto; font-size: 0.92em; color: #d8c7a8; }
    header.top button { font: inherit; padding: 4px 12px; cursor: pointer; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 28px 16px 50px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; font: inherit; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .err { color: #9b1c1c; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    .ok { color: #4a5d3a; margin-left: 8px; }
    label { display: block; margin: 8px 0; }
    input, button { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    table.rows { border-collapse: collapse; width: 100%; background: #fffdf8; }
    table.rows th, table.rows td { border: 1px solid #d9cbb2; padding: 8px 10px; text-align: center; }
    table.rows tr.full td { background: #f7e8e4; }
    table.rows input[type="number"] { width: 84px; margin: 0; }
    .badge { padding: 2px 10px; border-radius: 10px; background: #e3ecdc; color: #4a5d3a; }
    .badge.full { background: #f0d5cf; color: #9b1c1c; }
    .overlay { position: fixed; inset: 0; background: rgba(30, 22, 14, 0.45); }
    .drawer { position: fixed; top: 0; right: 0; width: 330px; max-width: 88vw; height: 100%; box-sizing: border-box; background: #fffdf8; padding: 22px 18px; box-shadow: -4px 0 14px rgba(0, 0, 0, 0.25); overflow: auto; }
    .drawer .close { float: right; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.me = null;
    this.page = pageFromHash();
    this.board = null;
    this.rowInfo = [];
    this.picked = null;
    this.ph = "4.2";
    this.err = "";
    this.rows = null;
    this.edits = {};
    this.rowsErr = "";
    this.savedRow = null;
    this.username = "admin";
    this.password = "123456";
  }

  connectedCallback() {
    super.connectedCallback();
    this._onHash = () => this.setPage(pageFromHash());
    window.addEventListener("hashchange", this._onHash);
    if (this.ready) this.boot();
  }

  disconnectedCallback() {
    window.removeEventListener("hashchange", this._onHash);
    super.disconnectedCallback();
  }

  async boot() {
    try {
      this.me = await api("/api/auth/me");
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      this.ready = false;
      return;
    }
    await this.loadPage();
  }

  async setPage(page) {
    if (page === this.page) return;
    this.page = page;
    this.err = "";
    this.rowsErr = "";
    this.picked = null;
    if (this.ready) await this.loadPage();
  }

  async loadPage() {
    if (this.page === "rows") await this.loadRows();
    else await this.refresh();
  }

  async refresh() {
    try {
      const [board, rowsData] = await Promise.all([api("/api/board"), api("/api/rows")]);
      this.board = board;
      this.rowInfo = rowsData.rows;
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || null;
      }
    } catch (e) {
      this.err = e.message;
    }
  }

  async loadRows() {
    this.rowsErr = "";
    try {
      const data = await api("/api/rows");
      this.rows = data.rows;
      const edits = {};
      for (const r of data.rows) edits[r.row] = { cap: r.cap ?? 1, enabled: r.enabled };
      this.edits = edits;
    } catch (e) {
      this.rowsErr = e.message;
    }
  }

  async login(e) {
    e.preventDefault();
    this.err = "";
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: this.username, password: this.password }),
      });
      localStorage.setItem(TOKEN_KEY, data.access_token);
      this.me = data.user;
      this.ready = true;
      await this.loadPage();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this.ready = false;
    this.me = null;
    this.board = null;
    this.picked = null;
    this.rows = null;
  }

  async writePh() {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/samples`, {
        method: "POST",
        body: JSON.stringify({ ph: Number(this.ph) }),
      });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async setStatus(status) {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  editRow(row, key, value) {
    this.edits = { ...this.edits, [row]: { ...this.edits[row], [key]: value } };
    this.savedRow = null;
  }

  async saveRow(row) {
    this.rowsErr = "";
    this.savedRow = null;
    const edit = this.edits[row];
    const cap = Number(edit.cap);
    if (!Number.isInteger(cap) || cap < 1) {
      this.rowsErr = "行口上限须为正整数";
      return;
    }
    try {
      await api(`/api/rows/${row}`, {
        method: "PUT",
        body: JSON.stringify({ cap, enabled: Boolean(edit.enabled) }),
      });
      this.savedRow = row;
      await this.loadRows();
    } catch (ex) {
      this.rowsErr = ex.message;
    }
  }

  get isAdmin() {
    return this.me && this.me.role === "admin";
  }

  render() {
    if (!this.ready) return this.renderLogin();
    return html`
      <header class="top">
        <span class="brand">南冈鞣场</span>
        <nav>
          <a href="#/map" class=${this.page === "map" ? "on" : ""}>坑位场地图</a>
          <a href="#/rows" class=${this.page === "rows" ? "on" : ""}>行口看板</a>
        </nav>
        <span class="who">${this.me ? `${this.me.username} · ${ROLE_LABELS[this.me.role] || this.me.role}` : ""}</span>
        <button @click=${this.logout}>退出</button>
      </header>
      ${this.page === "rows" ? this.renderRows() : this.renderMap()}
    `;
  }

  renderLogin() {
    return html`<div class="wrap">
      <h1>南冈鞣场</h1>
      <form @submit=${this.login} autocomplete="off">
        <label>用户名
          <input name="username" autocomplete="off" .value=${this.username} @input=${(e) => (this.username = e.target.value)} />
        </label>
        <label>密码
          <input name="password" type="password" autocomplete="off" .value=${this.password} @input=${(e) => (this.password = e.target.value)} />
        </label>
        <p class="hint">已预填 admin / 123456，另有 worker / 123456</p>
        <button>登录</button>
      </form>
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }

  renderMap() {
    if (!this.board) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`<div class="wrap">
      <h1>${this.board.yard}</h1>
      <p>${this.board.village} · 点坑登记浸液酸碱度；放液须最近读数 3.5～5.0</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => (this.picked = p)}>
            <strong>${p.code}</strong><br />${LABELS[p.status]}
          </button>`
        )}
      </div>
      ${this.picked ? this.renderDrawer() : this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }

  renderDrawer() {
    const p = this.picked;
    const info = this.rowInfo.find((r) => r.row === p.row);
    const full = info && info.enabled && info.cap != null && info.used >= info.cap;
    return html`
      <div class="overlay" @click=${() => (this.picked = null)}></div>
      <aside class="drawer">
        <button class="close" @click=${() => (this.picked = null)}>×</button>
        <h3>${p.code} · ${LABELS[p.status]}</h3>
        <p>最近酸碱度：${p.latestPh ?? "无"} · ${p.sampleCount} 次</p>
        ${info
          ? html`<p class="hint">
              ${info.label}鞣制中已用 ${info.used}${info.cap != null ? ` / 上限 ${info.cap}` : " / 未设上限"}${info.enabled ? "" : "（开关未开）"}${full ? " · 已满" : ""}
            </p>`
          : ""}
        <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
        <button @click=${this.writePh}>登记酸碱度</button>
        <div>
          <button @click=${() => this.setStatus("fill")}>注液</button>
          <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
          <button @click=${() => this.setStatus("drained")}>已放液</button>
        </div>
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      </aside>`;
  }

  renderRows() {
    if (!this.rows) return html`<div class="wrap">${this.rowsErr || "装载行口…"}</div>`;
    const isAdmin = this.isAdmin;
    return html`<div class="wrap">
      <h2>行口看板</h2>
      <p class="hint">
        已用数 = 该行正处于鞣制中的坑数。开关打开且已用满上限时，该行不能再拨入鞣制中；登酸碱、标已放液不吃行上限。
        ${isAdmin ? "" : "（操作工只能查看，数字与开关由管理员改）"}
      </p>
      <table class="rows">
        <thead>
          <tr>
            <th>行口</th><th>并存上限</th><th>开关</th><th>已用数</th><th>状态</th>${isAdmin ? html`<th>操作</th>` : ""}
          </tr>
        </thead>
        <tbody>
          ${this.rows.map((r) => {
            const full = r.enabled && r.cap != null && r.used >= r.cap;
            const edit = this.edits[r.row] || { cap: r.cap ?? 1, enabled: r.enabled };
            return html`<tr class=${full ? "full" : ""}>
              <td>${r.label}</td>
              <td>
                ${isAdmin
                  ? html`<input type="number" min="1" step="1" .value=${String(edit.cap)} @input=${(e) => this.editRow(r.row, "cap", e.target.value)} />`
                  : r.cap ?? "未设"}
              </td>
              <td>
                ${isAdmin
                  ? html`<input type="checkbox" .checked=${Boolean(edit.enabled)} @change=${(e) => this.editRow(r.row, "enabled", e.target.checked)} />`
                  : r.enabled ? "开" : "关"}
              </td>
              <td>${r.used}</td>
              <td>${full ? html`<span class="badge full">已满</span>` : html`<span class="badge">可拨</span>`}</td>
              ${isAdmin
                ? html`<td>
                    <button @click=${() => this.saveRow(r.row)}>保存</button>
                    ${this.savedRow === r.row ? html`<span class="ok">已保存</span>` : ""}
                  </td>`
                : ""}
            </tr>`;
          })}
        </tbody>
      </table>
      ${this.rowsErr ? html`<p class="err">${this.rowsErr}</p>` : ""}
    </div>`;
  }
}

customElements.define("tan-yard", TanYard);
