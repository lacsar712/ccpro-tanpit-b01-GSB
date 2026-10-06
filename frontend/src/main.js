import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || "请求失败");
    err.status = res.status;
    throw err;
  }
  return data;
}

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    route: { type: String },
    board: { type: Object },
    picked: { type: Object },
    ph: { type: String },
    err: { type: String },
    rowsErr: { type: String },
    rowsOk: { type: String },
    username: { type: String },
    password: { type: String },
    rowEdits: { type: Object },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", "STKaiti", serif; color: #2b2118; }
    .topbar { background: #3a2d1f; color: #f3e9d8; padding: 10px 18px; display: flex; align-items: center; gap: 18px; }
    .topbar .brand { font-size: 1.15em; font-weight: bold; }
    .topbar a { color: #e8d5b0; text-decoration: none; padding: 4px 8px; border-radius: 4px; }
    .topbar a.active, .topbar a:hover { background: #5a4631; color: #fff; }
    .topbar .spacer { flex: 1; }
    .topbar .role { font-size: 0.85em; color: #cbb894; }
    .topbar button { background: #6d5235; color: #fff; border: 0; border-radius: 4px; padding: 5px 12px; cursor: pointer; }
    .wrap { max-width: 960px; margin: 0 auto; padding: 24px 16px 50px; }
    .rowblock { margin-bottom: 22px; }
    .rowhead { display: flex; align-items: baseline; gap: 10px; margin: 0 0 8px; }
    .rowhead h2 { margin: 0; font-size: 1.15em; }
    .usage { font-size: 0.9em; color: #6b5a48; }
    .fulltag { color: #9b1c1c; font-weight: bold; }
    .offtag { color: #6b5a48; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
    .pit { min-height: 92px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; font-family: inherit; }
    .pit strong { font-size: 1.05em; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .err { color: #9b1c1c; }
    .ok { color: #38661c; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    label { display: block; margin: 8px 0; }
    input, button { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    table { border-collapse: collapse; width: 100%; background: #fff8ee; }
    th, td { border: 1px solid #d8c7ad; padding: 10px 12px; text-align: center; }
    th { background: #efe2cb; }
    td.num input { width: 80px; text-align: center; }
    .drawer-mask { position: fixed; inset: 0; background: rgba(40, 30, 18, 0.45); }
    .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 360px; max-width: 88vw; background: #fbf5ea;
      box-shadow: -4px 0 16px rgba(0, 0, 0, 0.25); padding: 22px 20px; overflow-y: auto; }
    .drawer h3 { margin-top: 0; }
    .drawer .close { float: right; border: 0; background: transparent; font-size: 1.3em; cursor: pointer; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.route = (location.hash || "#/") === "#/rows" ? "rows" : "yard";
    this.board = null;
    this.picked = null;
    this.ph = "4.2";
    this.err = "";
    this.rowsErr = "";
    this.rowsOk = "";
    this.username = "admin";
    this.password = "123456";
    this.rowEdits = {};
    window.addEventListener("hashchange", () => {
      this.route = location.hash === "#/rows" ? "rows" : "yard";
    });
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.ready) this.refresh();
  }

  get role() {
    return this.board?.role || "";
  }

  rowInfo(row) {
    return (this.board?.rows || []).find((r) => r.row === row);
  }

  async refresh() {
    try {
      this.board = await api("/api/board");
      const edits = {};
      for (const r of this.board.rows) {
        edits[r.row] = { cap: String(r.cap ?? 1), enabled: r.enabled };
      }
      this.rowEdits = edits;
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || null;
      }
    } catch (e) {
      if (e.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        this.ready = false;
      }
      this.err = e.message;
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
      this.ready = true;
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this.ready = false;
    this.board = null;
    this.picked = null;
  }

  openPit(p) {
    this.picked = p;
    this.err = "";
  }

  async writePh() {
    this.err = "";
    try {
      await api(`/api/pits/${this.picked.id}/samples`, {
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
      await api(`/api/pits/${this.picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async saveRow(row) {
    this.rowsErr = "";
    this.rowsOk = "";
    const edit = this.rowEdits[row];
    const cap = Number(edit.cap);
    if (!Number.isInteger(cap) || cap < 1) {
      this.rowsErr = "鞣制中并存上限须为正整数";
      return;
    }
    try {
      const data = await api(`/api/rows/${row}`, {
        method: "POST",
        body: JSON.stringify({ cap, enabled: edit.enabled }),
      });
      this.board = { ...this.board, rows: data.rows };
      this.rowsOk = "已保存";
    } catch (ex) {
      this.rowsErr = ex.message;
    }
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

  renderTopbar() {
    return html`<nav class="topbar">
      <span class="brand">南冈鞣场</span>
      <a href="#/" class=${this.route === "yard" ? "active" : ""}>坑位场地图</a>
      <a href="#/rows" class=${this.route === "rows" ? "active" : ""}>行口看板</a>
      <span class="spacer"></span>
      <span class="role">${this.role === "admin" ? "管理员" : "操作工"}</span>
      <button @click=${this.logout}>退出</button>
    </nav>`;
  }

  renderRowTag(info) {
    if (!info || info.cap == null) return "";
    if (!info.enabled) return html`<span class="offtag">（行口已关）</span>`;
    if (info.used >= info.cap) return html`<span class="fulltag">已满 ${info.used}/${info.cap}</span>`;
    return html`<span class="usage">鞣制中 ${info.used}/${info.cap}</span>`;
  }

  renderYard() {
    const rows = [...new Set(this.board.pits.map((p) => p.row))].sort((a, b) => a - b);
    return html`
      <p>${this.board.village} · 点坑开抽屉登记浸液酸碱度、拨坑态；放液须最近读数 3.5～5.0</p>
      ${rows.map((row) => {
        const info = this.rowInfo(row);
        const pits = this.board.pits.filter((p) => p.row === row).sort((a, b) => a.col - b.col);
        return html`<section class="rowblock">
          <div class="rowhead"><h2>${info?.label || `第${row + 1}排`}</h2>${this.renderRowTag(info)}</div>
          <div class="grid">
            ${pits.map(
              (p) => html`<button class="pit ${p.status}" @click=${() => this.openPit(p)}>
                <strong>${p.code}</strong><br />${LABELS[p.status]}
              </button>`
            )}
          </div>
        </section>`;
      })}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      ${this.picked ? this.renderDrawer() : ""}
    `;
  }

  renderDrawer() {
    const p = this.picked;
    const info = this.rowInfo(p.row);
    const full = info && info.enabled && info.cap != null && info.used >= info.cap;
    return html`
      <div class="drawer-mask" @click=${() => (this.picked = null)}></div>
      <aside class="drawer">
        <button class="close" @click=${() => (this.picked = null)}>×</button>
        <h3>${p.code} · ${LABELS[p.status]}</h3>
        <p class="hint">${info?.label || `第${p.row + 1}排`} · ${this.renderRowTag(info)}</p>
        <p>最近酸碱度：${p.latestPh ?? "无"} · 共 ${p.sampleCount} 次</p>
        <label>本次酸碱度
          <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
        </label>
        <button @click=${this.writePh}>登记酸碱度</button>
        <hr />
        <p class="hint">拨坑态：</p>
        <button @click=${() => this.setStatus("fill")}>注液</button>
        <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
        <button @click=${() => this.setStatus("drained")}>已放液</button>
        ${full ? html`<p class="fulltag">本行鞣制中口数已满，不能再拨成鞣制中</p>` : ""}
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      </aside>
    `;
  }

  renderRows() {
    const isAdmin = this.role === "admin";
    return html`
      <h1>行口看板</h1>
      <p class="hint">${isAdmin
        ? "按行设置鞣制中并存上限（正整数）与行口开关；开关打开且已用满时，再拨鞣制中会被挡住。"
        : "看板数字仅供查看；上限与开关由管理员设置。"}</p>
      <table>
        <thead><tr><th>行口</th><th>鞣制中上限</th><th>行口开关</th><th>已用数</th><th>状态</th>${isAdmin ? html`<th></th>` : ""}</tr></thead>
        <tbody>
          ${this.board.rows.map((r) => {
            const edit = this.rowEdits[r.row] || { cap: String(r.cap ?? 1), enabled: r.enabled };
            const full = r.enabled && r.cap != null && r.used >= r.cap;
            return html`<tr>
              <td>${r.label}</td>
              <td class="num">${isAdmin
                ? html`<input type="number" min="1" step="1" .value=${edit.cap}
                    @input=${(e) => (this.rowEdits = { ...this.rowEdits, [r.row]: { ...edit, cap: e.target.value } })} />`
                : html`<strong>${r.cap ?? "—"}</strong>`}</td>
              <td>${isAdmin
                ? html`<label style="margin:0"><input type="checkbox" .checked=${edit.enabled}
                    @change=${(e) => (this.rowEdits = { ...this.rowEdits, [r.row]: { ...edit, enabled: e.target.checked } })} />
                    ${edit.enabled ? "开" : "关"}</label>`
                : (r.enabled ? "开" : "关")}</td>
              <td><strong>${r.used}</strong></td>
              <td>${!r.enabled ? html`<span class="offtag">已关</span>` : full ? html`<span class="fulltag">已满</span>` : "可入"}</td>
              ${isAdmin ? html`<td><button @click=${() => this.saveRow(r.row)}>保存</button></td>` : ""}
            </tr>`;
          })}
        </tbody>
      </table>
      ${this.rowsErr ? html`<p class="err">${this.rowsErr}</p>` : ""}
      ${this.rowsOk ? html`<p class="ok">${this.rowsOk}</p>` : ""}
    `;
  }

  render() {
    if (!this.ready) return this.renderLogin();
    if (!this.board) return html`${this.renderTopbar()}<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`
      ${this.renderTopbar()}
      <div class="wrap">${this.route === "rows" ? this.renderRows() : this.renderYard()}</div>
    `;
  }
}

customElements.define("tan-yard", TanYard);
