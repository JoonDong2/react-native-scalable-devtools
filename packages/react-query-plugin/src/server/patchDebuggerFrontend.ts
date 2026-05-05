import fs from 'fs';
import os from 'os';
import path from 'path';

const RN_FUSEBOX_ENTRY = 'third-party/front_end/entrypoints/rn_fusebox/rn_fusebox.js';
const PANEL_DIR = 'third-party/front_end/panels/react_query';
const PANEL_META_FILE = 'react_query-meta.js';
const PANEL_FILE = 'react_query.js';
const PANEL_META_IMPORT =
  'import "../../panels/react_query/react_query-meta.js";';

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const source = path.join(src, entry.name);
    const target = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(source, target);
    } else {
      fs.copyFileSync(source, target);
    }
  }
}

export function preparePatchedFrontend(consumerDist: string): string | null {
  try {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-query-debugger-'));
    copyDir(consumerDist, tmpDir);

    const frontendRoot = path.join(tmpDir, 'third-party/front_end');
    const entryPath = path.join(tmpDir, RN_FUSEBOX_ENTRY);
    if (!fs.existsSync(entryPath)) {
      return null;
    }

    writePanelFiles(tmpDir);
    if (!patchRnFuseboxEntry(entryPath)) {
      return null;
    }

    return frontendRoot;
  } catch {
    return null;
  }
}

function writePanelFiles(distRoot: string): void {
  const panelDir = path.join(distRoot, PANEL_DIR);
  fs.mkdirSync(panelDir, { recursive: true });
  fs.writeFileSync(path.join(panelDir, PANEL_META_FILE), PANEL_META_SOURCE);
  fs.writeFileSync(path.join(panelDir, PANEL_FILE), PANEL_SOURCE);
}

function patchRnFuseboxEntry(entryPath: string): boolean {
  const content = fs.readFileSync(entryPath, 'utf8');
  if (content.includes(PANEL_META_IMPORT)) {
    return true;
  }

  fs.writeFileSync(entryPath, `${PANEL_META_IMPORT}\n${content}`);
  return true;
}

const PANEL_META_SOURCE = String.raw`import*as i18n from "../../core/i18n/i18n.js";
import*as ProtocolClient from "../../core/protocol_client/protocol_client.js";
import*as UI from "../../ui/legacy/legacy.js";

const UIStrings = {
  queries: "Queries",
  showQueries: "Show Queries",
};
const str = i18n.i18n.registerUIStrings("panels/react_query/react_query-meta.ts", UIStrings);
const i18nString = i18n.i18n.getLazilyComputedLocalizedString.bind(void 0, str);
const backend = ProtocolClient.InspectorBackend.inspectorBackend;

backend.registerCommand("ReactQuery.enable", [], [], "Enable React Query cache updates.");
backend.registerCommand("ReactQuery.disable", [], [], "Disable React Query cache updates.");
backend.registerCommand("ReactQuery.getQueries", [], ["snapshot"], "Get the latest React Query cache snapshot.");
backend.registerEvent("ReactQuery.queriesUpdated", ["snapshot", "updatedAt"]);

let loadedPanel;
async function loadPanel() {
  return loadedPanel || (loadedPanel = await import("./react_query.js"));
}

UI.ViewManager.registerViewExtension({
  location: "panel",
  id: "react-query",
  title: i18nString(UIStrings.queries),
  commandPrompt: i18nString(UIStrings.showQueries),
  persistence: "permanent",
  order: 43,
  loadView: async () => new (await loadPanel()).ReactQueryPanel.ReactQueryPanelImpl(),
  tags: [i18nString(UIStrings.queries)],
});
`;

const PANEL_SOURCE = String.raw`import*as SDK from "../../core/sdk/sdk.js";
import*as UI from "../../ui/legacy/legacy.js";

class ReactQueryPanelImpl extends UI.Panel.Panel {
  #target = null;
  #enabled = false;
  #visible = false;
  #retryTimer = null;
  #dispatcher = {
    queriesUpdated: (params) => {
      this.#renderQueryUpdate(params || {});
    },
  };
  #statusElement;
  #countElement;
  #selectedElement;
  #updatedElement;
  #detailElement;
  #queryListElement;
  #queries = [];
  #selectedQueryHash = null;

  constructor() {
    super("react-query", true);
    this.#buildLayout();
  }

  wasShown() {
    super.wasShown();
    this.#visible = true;
    void this.#connect();
  }

  willHide() {
    this.#visible = false;
    this.#clearReconnect();
    void this.#disconnect();
    super.willHide();
  }

  async #connect() {
    this.#clearReconnect();

    const target = this.#getTarget();
    if (!target) {
      this.#setStatus("Waiting for a React Native debugger target.");
      this.#scheduleReconnect();
      return;
    }

    if (this.#target !== target) {
      this.#target?.unregisterDispatcher("ReactQuery", this.#dispatcher);
      this.#target = target;
      this.#target.registerDispatcher("ReactQuery", this.#dispatcher);
    }

    const enabled = await this.#invoke("ReactQuery.enable");
    if (enabled?.getError?.()) {
      this.#setStatus(enabled.getError());
      this.#renderMessage(enabled.getError());
      this.#scheduleReconnect();
      return;
    }

    this.#enabled = true;
    this.#setStatus("Live");
    await this.#refresh();
  }

  async #disconnect() {
    if (!this.#target) {
      return;
    }

    if (this.#enabled) {
      await this.#invoke("ReactQuery.disable");
    }
    this.#target.unregisterDispatcher("ReactQuery", this.#dispatcher);
    this.#target = null;
    this.#enabled = false;
  }

  async #refresh() {
    if (!this.#target) {
      await this.#connect();
      return;
    }

    const result = await this.#invoke("ReactQuery.getQueries");
    if (result?.getError?.()) {
      this.#setStatus(result.getError());
      this.#renderMessage(result.getError());
      this.#scheduleReconnect();
      return;
    }

    this.#renderQueryUpdate(result || {});
  }

  async #invoke(method) {
    try {
      return await this.#target.getAgent("ReactQuery").invoke(method, {});
    } catch (error) {
      return { getError: () => error instanceof Error ? error.message : String(error) };
    }
  }

  #getTarget() {
    const manager = SDK.TargetManager.TargetManager.instance();
    return manager.primaryPageTarget() || manager.rootTarget() || manager.targets()[0] || null;
  }

  #renderQueryUpdate(params) {
    const snapshot = params.snapshot && typeof params.snapshot === "object" ? params.snapshot : params;
    const updatedAt = params.updatedAt || snapshot.updatedAt || Date.now();
    const queries = Array.isArray(snapshot.queries) ? snapshot.queries : [];

    this.#clearReconnect();
    this.#setStatus(snapshot.reason || "Live");
    this.#queries = queries;
    this.#countElement.textContent = String(snapshot.queryCount ?? queries.length);
    this.#updatedElement.textContent = formatTimestamp(updatedAt);
    this.#renderQueryList(queries, snapshot.reason);
  }

  #renderMessage(message) {
    this.#queries = [];
    this.#selectedQueryHash = null;
    this.#selectedElement.textContent = "-";
    this.#renderDetail(null);
    this.#queryListElement.replaceChildren();
    const empty = document.createElement("div");
    empty.textContent = message;
    empty.style.color = "var(--sys-color-token-subtle)";
    empty.style.padding = "12px";
    this.#queryListElement.appendChild(empty);
  }

  #renderQueryList(queries, reason) {
    this.#queryListElement.replaceChildren();

    if (!queries.length) {
      const empty = document.createElement("div");
      empty.textContent = reason || "No React Query cache entries received yet.";
      empty.style.color = "var(--sys-color-token-subtle)";
      empty.style.padding = "12px";
      this.#queryListElement.appendChild(empty);
      this.#selectedQueryHash = null;
      this.#selectedElement.textContent = "-";
      this.#renderDetail(null);
      return;
    }

    const selectedHash = this.#selectedQueryHash;
    const updatedSelected = selectedHash ? queries.find((query) => queryIdentity(query) === selectedHash) || null : null;
    if (selectedHash && !updatedSelected) {
      this.#selectedQueryHash = null;
      this.#selectedElement.textContent = "-";
      this.#renderDetail(null);
    } else if (updatedSelected) {
      this.#renderDetail(updatedSelected);
      this.#selectedElement.textContent = queryDisplayName(updatedSelected);
    }

    for (const query of queries) {
      const itemHash = queryIdentity(query);
      const selected = itemHash && itemHash === this.#selectedQueryHash;
      const button = document.createElement("button");
      button.type = "button";
      button.style.width = "100%";
      button.style.minHeight = "38px";
      button.style.padding = "6px 12px";
      button.style.border = "0";
      button.style.borderBottom = "1px solid var(--sys-color-divider)";
      button.style.background = selected ? "rgba(127, 127, 127, 0.16)" : "transparent";
      button.style.color = "var(--sys-color-on-surface)";
      button.style.cursor = "pointer";
      button.style.font = "inherit";
      button.style.textAlign = "left";

      const labelRow = document.createElement("div");
      labelRow.style.display = "flex";
      labelRow.style.alignItems = "center";
      labelRow.style.gap = "6px";
      labelRow.style.minWidth = "0";

      const label = document.createElement("div");
      label.textContent = queryDisplayName(query);
      label.style.minWidth = "0";
      label.style.flex = "0 1 auto";
      label.style.overflow = "hidden";
      label.style.textOverflow = "ellipsis";
      label.style.whiteSpace = "nowrap";
      labelRow.appendChild(label);

      for (const tag of queryStatusTags(query)) {
        labelRow.appendChild(createStatusTag(tag));
      }

      const meta = document.createElement("div");
      meta.textContent = queryMetaText(query);
      meta.style.color = "var(--sys-color-token-subtle)";
      meta.style.fontSize = "11px";
      meta.style.marginTop = "2px";
      meta.style.overflow = "hidden";
      meta.style.textOverflow = "ellipsis";
      meta.style.whiteSpace = "nowrap";

      button.append(labelRow, meta);
      button.addEventListener("click", () => {
        this.#selectedQueryHash = itemHash;
        this.#selectedElement.textContent = queryDisplayName(query);
        this.#renderDetail(query);
        this.#renderQueryList(this.#queries, null);
      });
      this.#queryListElement.appendChild(button);
    }
  }

  #renderDetail(query) {
    this.#detailElement.replaceChildren();
    this.#detailElement.hidden = !query;
    if (!query) {
      return;
    }

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "8px";
    header.style.flex = "0 0 45px";
    header.style.height = "45px";
    header.style.boxSizing = "border-box";
    header.style.overflow = "hidden";
    header.style.padding = "10px 12px";
    header.style.borderBottom = "1px solid var(--sys-color-divider)";

    const title = document.createElement("div");
    title.textContent = queryDisplayName(query);
    title.style.flex = "1 1 auto";
    title.style.fontWeight = "600";
    title.style.minWidth = "0";
    title.style.overflow = "hidden";
    title.style.textOverflow = "ellipsis";
    title.style.whiteSpace = "nowrap";
    header.appendChild(title);

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.style.flex = "0 0 auto";
    close.style.marginLeft = "auto";
    close.style.height = "24px";
    close.addEventListener("click", () => {
      this.#selectedQueryHash = null;
      this.#selectedElement.textContent = "-";
      this.#renderDetail(null);
      const buttons = this.#queryListElement.querySelectorAll("button");
      for (const button of buttons) {
        button.style.background = "transparent";
      }
    });
    header.appendChild(close);

    const fields = document.createElement("div");
    fields.style.display = "grid";
    fields.style.gap = "12px";
    fields.style.padding = "12px";

    fields.append(
      createDetailField("queryKey", query.queryKey, true),
      createDetailField("data", query.data, true),
      createDetailField("state", query.state, true)
    );
    if ("error" in query) {
      fields.appendChild(createDetailField("error", query.error, true));
    }

    this.#detailElement.append(header, fields);
  }

  #buildLayout() {
    this.contentElement.style.display = "flex";
    this.contentElement.style.flexDirection = "column";
    this.contentElement.style.height = "100%";
    this.contentElement.style.background = "var(--sys-color-cdt-base-container)";

    const toolbar = document.createElement("div");
    toolbar.style.display = "flex";
    toolbar.style.alignItems = "center";
    toolbar.style.gap = "8px";
    toolbar.style.flex = "0 0 36px";
    toolbar.style.height = "36px";
    toolbar.style.boxSizing = "border-box";
    toolbar.style.overflow = "hidden";
    toolbar.style.padding = "0 12px";
    toolbar.style.borderBottom = "1px solid var(--sys-color-divider)";

    const title = document.createElement("div");
    title.textContent = "React Query";
    title.style.fontWeight = "600";
    toolbar.appendChild(title);

    this.#statusElement = document.createElement("span");
    this.#statusElement.style.color = "var(--sys-color-token-subtle)";
    this.#statusElement.style.marginLeft = "auto";
    toolbar.appendChild(this.#statusElement);

    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = "Refresh";
    refresh.style.height = "24px";
    refresh.addEventListener("click", () => {
      void this.#refresh();
    });
    toolbar.appendChild(refresh);

    const summary = document.createElement("div");
    summary.style.display = "grid";
    summary.style.flex = "0 0 53px";
    summary.style.height = "53px";
    summary.style.boxSizing = "border-box";
    summary.style.gridTemplateColumns = "repeat(3, minmax(120px, 1fr))";
    summary.style.gridAutoRows = "52px";
    summary.style.gap = "1px";
    summary.style.overflow = "hidden";
    summary.style.borderBottom = "1px solid var(--sys-color-divider)";
    summary.style.background = "var(--sys-color-divider)";

    this.#countElement = createSummaryCell(summary, "Queries");
    this.#selectedElement = createSummaryCell(summary, "Selected");
    this.#updatedElement = createSummaryCell(summary, "Updated");

    const body = document.createElement("div");
    body.style.display = "flex";
    body.style.flex = "1 1 auto";
    body.style.minHeight = "0";

    this.#detailElement = document.createElement("section");
    this.#detailElement.hidden = true;
    this.#detailElement.style.display = "block";
    this.#detailElement.style.flex = "0 0 420px";
    this.#detailElement.style.minWidth = "280px";
    this.#detailElement.style.maxWidth = "52%";
    this.#detailElement.style.borderLeft = "1px solid var(--sys-color-divider)";
    this.#detailElement.style.overflow = "auto";
    this.#detailElement.style.userSelect = "text";
    this.#detailElement.style.background = "var(--sys-color-cdt-base-container)";

    this.#queryListElement = document.createElement("div");
    this.#queryListElement.style.flex = "1 1 auto";
    this.#queryListElement.style.minWidth = "0";
    this.#queryListElement.style.overflow = "auto";
    this.#queryListElement.style.background = "var(--sys-color-cdt-base-container)";
    this.#queryListElement.textContent = "No query state received yet.";

    body.append(this.#queryListElement, this.#detailElement);

    this.contentElement.append(toolbar, summary, body);
    this.#setStatus("Idle");
  }

  #setStatus(status) {
    this.#statusElement.textContent = status;
  }

  #scheduleReconnect() {
    if (!this.#visible || this.#retryTimer) {
      return;
    }
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      void this.#connect();
    }, 1500);
  }

  #clearReconnect() {
    if (!this.#retryTimer) {
      return;
    }
    clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }
}

function createSummaryCell(parent, label) {
  const cell = document.createElement("div");
  cell.style.background = "var(--sys-color-cdt-base-container)";
  cell.style.boxSizing = "border-box";
  cell.style.height = "52px";
  cell.style.overflow = "hidden";
  cell.style.padding = "8px 12px";
  cell.style.minWidth = "0";

  const labelElement = document.createElement("div");
  labelElement.textContent = label;
  labelElement.style.color = "var(--sys-color-token-subtle)";
  labelElement.style.fontSize = "11px";

  const valueElement = document.createElement("div");
  valueElement.textContent = "-";
  valueElement.style.height = "17px";
  valueElement.style.lineHeight = "17px";
  valueElement.style.marginTop = "4px";
  valueElement.style.overflow = "hidden";
  valueElement.style.textOverflow = "ellipsis";
  valueElement.style.whiteSpace = "nowrap";

  cell.append(labelElement, valueElement);
  parent.appendChild(cell);
  return valueElement;
}

function createDetailField(label, value, asJson) {
  const field = document.createElement("div");
  field.style.minWidth = "0";
  field.style.display = "block";
  field.style.contain = "layout paint";
  field.style.overflow = "visible";

  const labelElement = document.createElement("div");
  labelElement.textContent = label;
  labelElement.style.color = "var(--sys-color-token-subtle)";
  labelElement.style.fontSize = "11px";
  labelElement.style.marginBottom = "4px";

  const valueElement = document.createElement("pre");
  valueElement.textContent = formatDetailValue(value, Boolean(asJson));
  valueElement.style.margin = "0";
  valueElement.style.overflow = "visible";
  valueElement.style.whiteSpace = "pre-wrap";
  valueElement.style.wordBreak = "break-word";
  valueElement.style.font = "var(--source-code-font-size) var(--source-code-font-family)";

  field.append(labelElement, valueElement);
  return field;
}

function formatDetailValue(value, asJson) {
  if (asJson) {
    if (typeof value === "undefined") {
      return "undefined";
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  if (value === null) {
    return "null";
  }
  if (typeof value === "undefined") {
    return "undefined";
  }
  return String(value);
}

function queryDisplayName(query) {
  if (query && typeof query === "object" && typeof query.queryKeyLabel === "string" && query.queryKeyLabel.length) {
    return query.queryKeyLabel;
  }
  return "(unknown query)";
}

function queryIdentity(query) {
  if (!query || typeof query !== "object") {
    return null;
  }
  if (typeof query.queryHash === "string" && query.queryHash.length) {
    return query.queryHash;
  }
  return queryDisplayName(query);
}

function queryMetaText(query) {
  const state = query && typeof query === "object" && query.state && typeof query.state === "object" ? query.state : {};
  if (typeof state.dataUpdatedAt === "number" && state.dataUpdatedAt > 0) {
    return "updated " + formatTimestamp(state.dataUpdatedAt);
  }
  return "no update time";
}

function queryStatusTags(query) {
  const state = query && typeof query === "object" && query.state && typeof query.state === "object" ? query.state : {};
  const tags = [];
  if (state.status) {
    tags.push(String(state.status));
  }
  if (state.fetchStatus && state.fetchStatus !== state.status) {
    tags.push(String(state.fetchStatus));
  }
  return tags;
}

function createStatusTag(value) {
  const tag = document.createElement("span");
  const colors = statusTagColors(value);
  tag.textContent = value;
  tag.style.flex = "0 0 auto";
  tag.style.maxWidth = "96px";
  tag.style.overflow = "hidden";
  tag.style.textOverflow = "ellipsis";
  tag.style.whiteSpace = "nowrap";
  tag.style.padding = "2px 6px";
  tag.style.border = "0";
  tag.style.borderRadius = "999px";
  tag.style.background = colors.background;
  tag.style.color = colors.color;
  tag.style.fontSize = "10px";
  tag.style.fontWeight = "600";
  tag.style.lineHeight = "14px";
  return tag;
}

function statusTagColors(value) {
  switch (String(value).toLowerCase()) {
    case "success":
      return { background: "rgba(40, 167, 69, 0.18)", color: "#2e8540" };
    case "error":
      return { background: "rgba(220, 53, 69, 0.18)", color: "#c5221f" };
    case "pending":
    case "loading":
      return { background: "rgba(245, 166, 35, 0.2)", color: "#9a5f00" };
    case "fetching":
      return { background: "rgba(25, 118, 210, 0.18)", color: "#1967d2" };
    case "paused":
      return { background: "rgba(126, 87, 194, 0.18)", color: "#6f42c1" };
    case "idle":
      return { background: "rgba(127, 127, 127, 0.18)", color: "var(--sys-color-token-subtle)" };
    default:
      return { background: "rgba(3, 169, 244, 0.16)", color: "#007c91" };
  }
}

function formatTimestamp(value) {
  const timestamp = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "-";
  }
  return new Date(timestamp).toLocaleTimeString();
}

export const ReactQueryPanel = {
  ReactQueryPanelImpl,
};
`;
