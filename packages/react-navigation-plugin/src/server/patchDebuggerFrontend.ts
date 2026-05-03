import fs from 'fs';
import os from 'os';
import path from 'path';

const RN_FUSEBOX_ENTRY = 'third-party/front_end/entrypoints/rn_fusebox/rn_fusebox.js';
const PANEL_DIR = 'third-party/front_end/panels/react_navigation';
const PANEL_META_FILE = 'react_navigation-meta.js';
const PANEL_FILE = 'react_navigation.js';
const PANEL_META_IMPORT =
  'import "../../panels/react_navigation/react_navigation-meta.js";';

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
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-navigation-debugger-'));
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
  navigation: "Navigation",
  showNavigation: "Show Navigation",
};
const str = i18n.i18n.registerUIStrings("panels/react_navigation/react_navigation-meta.ts", UIStrings);
const i18nString = i18n.i18n.getLazilyComputedLocalizedString.bind(void 0, str);
const backend = ProtocolClient.InspectorBackend.inspectorBackend;

backend.registerCommand("ReactNavigation.enable", [], [], "Enable React Navigation state updates.");
backend.registerCommand("ReactNavigation.disable", [], [], "Disable React Navigation state updates.");
backend.registerCommand("ReactNavigation.getState", [], ["state"], "Get the latest React Navigation state.");
backend.registerEvent("ReactNavigation.stateUpdated", ["state", "updatedAt"]);

let loadedPanel;
async function loadPanel() {
  return loadedPanel || (loadedPanel = await import("./react_navigation.js"));
}

UI.ViewManager.registerViewExtension({
  location: "panel",
  id: "react-navigation",
  title: i18nString(UIStrings.navigation),
  commandPrompt: i18nString(UIStrings.showNavigation),
  persistence: "permanent",
  order: 42,
  loadView: async () => new (await loadPanel()).ReactNavigationPanel.ReactNavigationPanelImpl(),
  tags: [i18nString(UIStrings.navigation)],
});
`;

const PANEL_SOURCE = String.raw`import*as SDK from "../../core/sdk/sdk.js";
import*as UI from "../../ui/legacy/legacy.js";

class ReactNavigationPanelImpl extends UI.Panel.Panel {
  #target = null;
  #enabled = false;
  #visible = false;
  #retryTimer = null;
  #dispatcher = {
    stateUpdated: (params) => {
      this.#renderStateUpdate(params || {});
    },
  };
  #statusElement;
  #readyElement;
  #routeElement;
  #updatedElement;
  #detailElement;
  #routeListElement;
  #selectedRoute = null;

  constructor() {
    super("react-navigation", true);
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
      this.#target?.unregisterDispatcher("ReactNavigation", this.#dispatcher);
      this.#target = target;
      this.#target.registerDispatcher("ReactNavigation", this.#dispatcher);
    }

    const enabled = await this.#invoke("ReactNavigation.enable");
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
      await this.#invoke("ReactNavigation.disable");
    }
    this.#target.unregisterDispatcher("ReactNavigation", this.#dispatcher);
    this.#target = null;
    this.#enabled = false;
  }

  async #refresh() {
    if (!this.#target) {
      await this.#connect();
      return;
    }

    const result = await this.#invoke("ReactNavigation.getState");
    if (result?.getError?.()) {
      this.#setStatus(result.getError());
      this.#renderMessage(result.getError());
      this.#scheduleReconnect();
      return;
    }

    this.#renderStateUpdate(result || {});
  }

  async #invoke(method) {
    try {
      return await this.#target.getAgent("ReactNavigation").invoke(method, {});
    } catch (error) {
      return { getError: () => error instanceof Error ? error.message : String(error) };
    }
  }

  #getTarget() {
    const manager = SDK.TargetManager.TargetManager.instance();
    return manager.primaryPageTarget() || manager.rootTarget() || manager.targets()[0] || null;
  }

  #renderStateUpdate(params) {
    const snapshot = params.state && typeof params.state === "object" ? params.state : params;
    const updatedAt = params.updatedAt || snapshot.updatedAt || Date.now();
    const routePath = routePathFromSnapshot(snapshot);
    const items = navigationItemsFromSnapshot(snapshot);

    this.#clearReconnect();
    this.#setStatus(snapshot.reason || "Live");
    this.#readyElement.textContent = snapshot.isReady ? "Ready" : "Not ready";
    this.#routeElement.textContent = routePath || "(no route)";
    this.#updatedElement.textContent = formatTimestamp(updatedAt);
    this.#renderNavigationList(items);
  }

  #renderMessage(message) {
    this.#selectedRoute = null;
    this.#renderDetail(null);
    this.#routeListElement.replaceChildren();
    const empty = document.createElement("div");
    empty.textContent = message;
    empty.style.color = "var(--sys-color-token-subtle)";
    empty.style.padding = "12px";
    this.#routeListElement.appendChild(empty);
  }

  #renderNavigationList(items) {
    this.#routeListElement.replaceChildren();

    if (!items.length) {
      const empty = document.createElement("div");
      empty.textContent = "No navigation routes received yet.";
      empty.style.color = "var(--sys-color-token-subtle)";
      empty.style.padding = "12px";
      this.#routeListElement.appendChild(empty);
      this.#selectedRoute = null;
      this.#renderDetail(null);
      return;
    }

    const selectedKey = routeKey(this.#selectedRoute);
    const updatedSelected = selectedKey ? items.find((item) => routeKey(item.route) === selectedKey)?.route || null : null;
    if (selectedKey && !updatedSelected) {
      this.#selectedRoute = null;
      this.#renderDetail(null);
    } else if (updatedSelected) {
      this.#selectedRoute = updatedSelected;
      this.#renderDetail(updatedSelected);
    }

    for (const item of items) {
      const itemKey = routeKey(item.route);
      const selectedItemKey = routeKey(this.#selectedRoute);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = routeDisplayName(item.route);
      button.style.width = "100%";
      button.style.minHeight = "32px";
      button.style.padding = "6px 12px";
      button.style.border = "0";
      button.style.borderBottom = "1px solid var(--sys-color-divider)";
      button.style.background = itemKey && itemKey === selectedItemKey ? "rgba(127, 127, 127, 0.16)" : "transparent";
      button.style.color = "var(--sys-color-on-surface)";
      button.style.cursor = "pointer";
      button.style.font = "inherit";
      button.style.textAlign = "left";
      button.style.overflow = "hidden";
      button.style.textOverflow = "ellipsis";
      button.style.whiteSpace = "nowrap";
      button.addEventListener("click", () => {
        this.#selectedRoute = item.route;
        this.#renderDetail(item.route);
        this.#renderNavigationList(items);
      });
      this.#routeListElement.appendChild(button);
    }
  }

  #renderDetail(route) {
    this.#detailElement.replaceChildren();
    this.#detailElement.hidden = !route;
    if (!route) {
      return;
    }

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "8px";
    header.style.padding = "10px 12px";
    header.style.borderBottom = "1px solid var(--sys-color-divider)";

    const title = document.createElement("div");
    title.textContent = routeDisplayName(route);
    title.style.fontWeight = "600";
    title.style.minWidth = "0";
    title.style.overflow = "hidden";
    title.style.textOverflow = "ellipsis";
    title.style.whiteSpace = "nowrap";
    header.appendChild(title);

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.style.marginLeft = "auto";
    close.style.height = "24px";
    close.addEventListener("click", () => {
      this.#selectedRoute = null;
      this.#renderDetail(null);
      const buttons = this.#routeListElement.querySelectorAll("button");
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
      createDetailField("name", route.name),
      createDetailField("key", route.key),
      createDetailField("params", route.params, true)
    );

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
    toolbar.style.minHeight = "36px";
    toolbar.style.padding = "0 12px";
    toolbar.style.borderBottom = "1px solid var(--sys-color-divider)";

    const title = document.createElement("div");
    title.textContent = "React Navigation";
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
    summary.style.gridTemplateColumns = "repeat(3, minmax(120px, 1fr))";
    summary.style.gap = "1px";
    summary.style.borderBottom = "1px solid var(--sys-color-divider)";
    summary.style.background = "var(--sys-color-divider)";

    this.#readyElement = createSummaryCell(summary, "Status");
    this.#routeElement = createSummaryCell(summary, "Route");
    this.#updatedElement = createSummaryCell(summary, "Updated");

    const body = document.createElement("div");
    body.style.display = "flex";
    body.style.flex = "1 1 auto";
    body.style.minHeight = "0";

    this.#detailElement = document.createElement("section");
    this.#detailElement.hidden = true;
    this.#detailElement.style.flex = "0 0 320px";
    this.#detailElement.style.minWidth = "240px";
    this.#detailElement.style.maxWidth = "45%";
    this.#detailElement.style.borderLeft = "1px solid var(--sys-color-divider)";
    this.#detailElement.style.overflow = "auto";
    this.#detailElement.style.userSelect = "text";
    this.#detailElement.style.background = "var(--sys-color-cdt-base-container)";

    this.#routeListElement = document.createElement("div");
    this.#routeListElement.style.flex = "1 1 auto";
    this.#routeListElement.style.minWidth = "0";
    this.#routeListElement.style.overflow = "auto";
    this.#routeListElement.style.background = "var(--sys-color-cdt-base-container)";
    this.#routeListElement.textContent = "No navigation state received yet.";

    body.append(this.#routeListElement, this.#detailElement);

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
  cell.style.padding = "8px 12px";
  cell.style.minWidth = "0";

  const labelElement = document.createElement("div");
  labelElement.textContent = label;
  labelElement.style.color = "var(--sys-color-token-subtle)";
  labelElement.style.fontSize = "11px";

  const valueElement = document.createElement("div");
  valueElement.textContent = "-";
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

  const labelElement = document.createElement("div");
  labelElement.textContent = label;
  labelElement.style.color = "var(--sys-color-token-subtle)";
  labelElement.style.fontSize = "11px";
  labelElement.style.marginBottom = "4px";

  const valueElement = document.createElement("pre");
  valueElement.textContent = formatDetailValue(value, Boolean(asJson));
  valueElement.style.margin = "0";
  valueElement.style.overflow = "auto";
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

function navigationItemsFromSnapshot(snapshot) {
  const items = [];
  const state = snapshot && typeof snapshot === "object" ? snapshot.state : null;

  if (isNavigationState(state)) {
    for (const route of routesForState(state)) {
      appendVisibleRoutes(items, route);
    }
  }

  if (!items.length && snapshot && typeof snapshot === "object" && isRoute(snapshot.currentRoute)) {
    items.push({ route: snapshot.currentRoute });
  }

  return items;
}

function appendVisibleRoutes(items, route) {
  if (!isRoute(route)) {
    return;
  }

  const nestedState = route.state;
  if (isNavigationState(nestedState)) {
    const nestedRoutes = routesForState(nestedState);
    if (nestedRoutes.length) {
      for (const nestedRoute of nestedRoutes) {
        appendVisibleRoutes(items, nestedRoute);
      }
      return;
    }
  }

  items.push({ route });
}

function routesForState(state) {
  const routes = Array.isArray(state.routes) ? state.routes.filter(isRoute) : [];
  const history = Array.isArray(state.history) ? state.history : [];
  if (!history.length) {
    return routes;
  }

  const routesByKey = new Map();
  for (const route of routes) {
    const key = routeKey(route);
    if (key) {
      routesByKey.set(key, route);
    }
  }

  const historyRoutes = [];
  for (const entry of history) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const key = typeof entry.key === "string" ? entry.key : null;
    if (!key) {
      continue;
    }
    historyRoutes.push(routesByKey.get(key) || { key, params: null });
  }

  return historyRoutes.length ? historyRoutes : routes;
}

function isNavigationState(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.routes));
}

function isRoute(value) {
  return Boolean(value && typeof value === "object" && ("name" in value || "key" in value));
}

function routeDisplayName(route) {
  if (route && typeof route === "object" && route.name !== null && typeof route.name !== "undefined") {
    const name = String(route.name).trim();
    if (name) {
      return name;
    }
  }
  return "(unnamed route)";
}

function routeKey(route) {
  if (!route || typeof route !== "object" || route.key === null || typeof route.key === "undefined") {
    return null;
  }
  return String(route.key);
}

function routePathFromSnapshot(snapshot) {
  const names = [];
  let state = snapshot.state;
  while (state && typeof state === "object" && Array.isArray(state.routes)) {
    const index = typeof state.index === "number" ? state.index : state.routes.length - 1;
    const route = state.routes[index];
    if (!route || typeof route !== "object") {
      break;
    }
    names.push(route.name || route.key || String(index));
    state = route.state;
  }
  if (!names.length && snapshot.currentRoute && typeof snapshot.currentRoute === "object") {
    names.push(snapshot.currentRoute.name || snapshot.currentRoute.key || "");
  }
  return names.filter(Boolean).join(" / ");
}

function formatTimestamp(value) {
  const timestamp = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(timestamp)) {
    return "-";
  }
  return new Date(timestamp).toLocaleTimeString();
}

export const ReactNavigationPanel = {
  ReactNavigationPanelImpl,
};
`;
