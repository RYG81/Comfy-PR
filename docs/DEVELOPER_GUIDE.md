# Frontend & UI Integration — ComfyUI Custom Extension Developer Guide

Verified against: `Comfy-Org/ComfyUI_frontend` v1.50.2 (`src/types/comfy.ts`, `src/types/extensionTypes.ts`, `src/platform/settings/types.ts`) and battle-tested against `pixaroma/ComfyUI-Pixaroma` v1.4.99 (318 JS files, 73 `registerExtension` calls), currently the most sophisticated UI-integration pack in the wild.

---

## 1. The extension object — complete hook list

```js
import { app } from "/scripts/app.js";

app.registerExtension({ name: "Author.Feature", /* hooks below */ });
```

`name` is required and must be unique. Every other key is optional.

### Declarative UI surfaces (data, not code)

| Key | Puts UI in |
|---|---|
| `commands: ComfyCommand[]` | Command palette — backing action for everything else |
| `keybindings: Keybinding[]` | Keyboard shortcuts, bound to a `commandId` |
| `menuCommands: {path: string[], commands: string[]}[]` | Top menubar, grouped by path |
| `settings: SettingParams[]` | Settings dialog |
| `bottomPanelTabs: BottomPanelExtension[]` | Bottom panel (terminal/shortcuts area) |
| `aboutPageBadges: {label, url, icon, severity?}[]` | About page |
| `topbarBadges: TopbarBadge[]` | Topbar badge strip |
| `actionBarButtons: ActionBarButton[]` | **Top action bar — the modern way to add a button** |

### Lifecycle & graph hooks (functions)

| Hook | When |
|---|---|
| `init(app)` | Earliest — before node defs are fetched |
| `setup(app)` | After the app is constructed; where DOM work belongs |
| `addCustomNodeDefs(defs, app)` | Mutate/inject node definitions |
| `getCustomWidgets(app)` | Register named widget constructors |
| `beforeRegisterNodeDef(nodeType, nodeData, app)` | Patch a node class prototype |
| `beforeRegisterVueAppNodeDefs(defs, app)` | Nodes 2.0 (Vue renderer) equivalent |
| `registerCustomNodes(app)` | Register frontend-only nodes |
| `nodeCreated(node, app)` | Per node instance |
| `loadedGraphNode(node, app)` | Node restored from a saved workflow |
| `beforeConfigureGraph` / `afterConfigureGraph` | Around workflow load |
| `onNodeOutputsUpdated(outputs)` | Execution results arrived |
| `getSelectionToolboxCommands(item)` | Buttons on the floating toolbar above a selection |
| `getCanvasMenuItems()` | Right-click on empty canvas |
| `getNodeMenuItems(node)` | Right-click on a node |
| `onAuthUserResolved` / `onAuthTokenRefreshed` / `onAuthUserLogout` | Auth events |

> **Unknown keys are ignored, missing hooks are simply never called.** That is the compatibility mechanism: shipping `actionBarButtons` on an old frontend is harmless (no button, no error), and implementing `getSelectionToolboxCommands` on a build that predates it is equally harmless.

---

## 2. Adding a button to the top bar — pick the right mechanism

This is the most-requested integration and there are three answers. Choose deliberately.

### A. `actionBarButtons` — declarative, preferred (frontend ≥ ~1.4x)

```js
app.registerExtension({
  name: "MyPack.Toolbar",
  actionBarButtons: [
    {
      icon: "icon-[lucide--wand-sparkles]",
      label: "Enhance",
      tooltip: "Run the enhance pass",
      class: "mypack-btn",
      onClick: () => doTheThing(),
    },
  ],
});
```

No DOM, no timing, no retry loop, survives frontend re-renders. **Use this unless you need something it can't express.**

### B. Manual DOM injection — for stateful/toggle buttons and older builds

`actionBarButtons` has no "active/pressed" state. A toggle button that must tint itself still needs DOM. The pattern proven in Pixaroma (and rgthree before it):

```js
function mountToolbarButton() {
  if (document.querySelector(".mypack-btn")) return;
  const anchor = app.menu?.settingsGroup?.element;
  if (!anchor) {
    mountToolbarButton._tries = (mountToolbarButton._tries || 0) + 1;
    if (mountToolbarButton._tries > 20) {
      console.warn("[MyPack] toolbar mount: settingsGroup never appeared");
      return;
    }
    return void setTimeout(mountToolbarButton, 250);
  }
  const group = document.createElement("div");
  group.className = "comfyui-button-group mypack-group";
  const btn = document.createElement("button");
  btn.className = "comfyui-button mypack-btn";
  btn.title = "Toggle the thing (Alt+T)";
  btn.append(el("span", "mypack-btn-icon"));
  btn.addEventListener("click", toggle);
  group.append(btn);
  anchor.before(group);
}

app.registerExtension({ name: "MyPack.Toolbar", setup() { mountToolbarButton(); } });
```

Five rules learned the hard way:

1. **Wrap in `.comfyui-button-group`.** The group carries the toolbar's spacing. If you later hide just the `<button>`, its gap stays behind.
2. **Reuse `.comfyui-button`** so you inherit theme, hover and dark/light automatically.
3. **Retry, bounded.** `app.menu.settingsGroup` is late on a cold start. Retry ~20×250 ms, then warn and stop.
4. **Idempotent mount** — `setup` can effectively run again across reloads.
5. **Inject your CSS from every entry point** that can be first (mount *and* panel-open), guarded by `document.getElementById(CSS_ID)`.

### C. Command + keybinding only — no button at all

Always register the **command** even when you also add a button. Commands are independent of the DOM: the shortcut and the palette entry keep working when the button is hidden, missing, or the frontend changed. Pixaroma's toolbar-visibility feature relies on exactly this separation.

```js
commands: [{ id: "MyPack.Toggle", label: "Toggle Thing", icon: "mypack-cmd-icon", function: toggle }],
keybindings: [{ combo: { key: "t", alt: true }, commandId: "MyPack.Toggle" }],
```

> **Command tooltips come from i18n, not `label`.** The hover text is looked up in `locales/en/commands.json` keyed by the command id with dots lowercased to underscores: `MyPack.Toggle` → `MyPack_Toggle`. Ship that file or your button hovers blank.

---

## 3. Other chrome surfaces

```js
// Badge in the topbar
topbarBadges: [{ text: "3 updates", label: "NEW", variant: "info", icon: "pi-exclamation-triangle", tooltip: "..." }],

// Badge on the About page
aboutPageBadges: [{ label: "MyPack Docs", url: "https://…", icon: "pi-book" }],

// Menubar entries (commands must also exist in `commands`)
menuCommands: [{ path: ["Extensions", "MyPack"], commands: ["MyPack.Toggle"] }],

// Bottom panel tab — Vue component or raw DOM
bottomPanelTabs: [{
  id: "mypack.logs", title: "MyPack Logs", type: "custom",
  render: (container) => { container.append(buildLogView()); },
  destroy: () => teardown(),
}],
```

**Sidebar tab** is *not* on the extension object — it's imperative, from `setup()`:

```js
setup() {
  app.extensionManager.registerSidebarTab({
    id: "mypack.browser",
    title: "MyPack",
    icon: "pi pi-images",
    tooltip: "Browse MyPack assets",
    type: "custom",
    render: (el) => { el.append(buildPanel()); },
  });
}
```

`app.extensionManager` is the workspace store. The store-level `registerSidebarTab` is marked deprecated in favour of `sidebarTab.registerSidebarTab`, but the top-level call remains the widely-used, working entry point.

---

## 4. Per-node UI: selection toolbox, context menus

**Selection toolbox** — the floating bar above a selected node, next to native ⓘ Node Info.

ComfyUI calls the hook on every extension, unions the returned command ids, looks each up in the command store, and renders `<i :class="command.icon">` + `@click`.

```js
commands: [
  { id: "MyPack.Help", label: "Help", icon: "mypack-help-icon", function: showHelp },
  { id: "MyPack.Config", label: "Settings", icon: "mypack-cfg-icon", function: showCfg },
],
getSelectionToolboxCommands(item) {
  if (!item?.comfyClass?.startsWith("MyPack_")) return [];
  return ["MyPack.Config", "MyPack.Help"];
},
```

Because `icon` becomes a **CSS class on an `<i>`**, draw the glyph in CSS. Use a **mask** so it follows your theme colour instead of baking a colour into the SVG:

```css
.mypack-help-icon {
  display: inline-flex; width: 16px; height: 16px; border-radius: 50%;
  background: var(--mypack-brand);
}
.mypack-help-icon::before {
  content: ""; width: 10px; height: 10px; background-color: #fff;
  -webkit-mask: url("…/question.svg") center / contain no-repeat;
  mask: url("…/question.svg") center / contain no-repeat;
}
```

**Context menus** — use the hooks, never the old `getNodeMenuOptions` monkey-patch:

```js
getNodeMenuItems(node) {                       // right-click a node
  if (!isMine(node)) return [];
  return [null, { content: "⚙ MyPack settings", callback: () => open(node) }];
},
getCanvasMenuItems() {                         // right-click empty canvas
  return [{ content: "👑 MyPack Browser", callback: toggle }];
},
```

**Centralize these.** One extension that reads a registry of "which of my nodes opted in" scales; wiring a menu item inside each of 70 node files does not. Give opted-in nodes an `ownMenuItem: true` escape hatch so a node with a richer custom menu isn't doubled up.

---

## 5. Settings

```js
settings: [{
  id: "MyPack.Feature.Enabled",
  name: "Enable the feature",
  type: "boolean",
  defaultValue: true,
  tooltip: "What it does and what it does NOT do.",
  category: ["👑 MyPack", "Feature"],
  onChange: (newValue, oldValue) => apply(newValue),
  attrs: { min: 1, max: 10 },
  options: ["a", "b"],
  experimental: false, deprecated: false,
  sortOrder: 0,
  versionAdded: "1.2.0",
}],
```

Four traps, all verified in the wild:

1. **`onChange` fires BEFORE the store write lands.** Reading the setting back inside `onChange` returns the *previous* value. Use the `newValue` argument. If you must trigger something that re-reads the store, defer: `setTimeout(fn, 0)`.
2. **Give each setting its own `category` leaf.** Two settings sharing a leaf have been observed collapsing into a single row. Prefix related leaves (`"Toolbar: Align"`, `"Toolbar: Help"`) so they still sort together as a block.
3. **Reading a setting can throw on first run** (never written / not yet registered). Wrap in `try/catch` and treat unreadable as the default — and put the *consequences* of the default outside the `try` so a failed read still leaves a sane UI.
4. **Treat "not explicitly false" as on** for visibility toggles, so a first run never hides something the user hasn't opted out of.

The `color` input stores values without `#` but requires `#` when typed — say so in the tooltip.

---

## 6. Surviving hosted / sub-path deployments

The single most under-tested area in community packs. Everything works on localhost and breaks on a cloud host.

**Never write a root-relative URL.** `/view?...` or `fetch("/mypack/api/x")` resolves against the *page origin*, which on a hosted platform is the vendor's web app, not ComfyUI's API → `401404`.

```js
import { api } from "/scripts/api.js";

export function myApiUrl(route) {
  try { if (typeof api?.apiURL === "function") return api.apiURL(route); }
  catch { /* a broken helper must not take the feature down */ }
  return route;
}
``

- `api.apiURL(route)` prefixes `api_base + "/api"`. Locally that's a no-op because ComfyUI registers an `/api`-prefixed alias for every non-static route.
- **`api.fetchApi` already calls `apiURL` internally.** Wrapping it again double-prefixes. It *looks* fine locally (empty base + a `startsWith("/api")` guard) and 404s under a sub-path. `myApiUrl` is for a bare `fetch()`, **never** for `api.fetchApi`.
- **"Our JS loads, so root paths reach ComfyUI" is false.** Hosts serve the frontend *static files* at the root while the *API* lives elsewhere. Same server locally; not in prod.
- **Serving your own assets:** hosted gateways route by **file extension**. A URL whose *path* ends in `.svg.png.ttf.mp3` gets answered by their static server and never reaches ComfyUI, regardless of the path. Put the filename in the **query string** and keep the path extensionless: `/mypack/api/asset?path=icons/play.svg`.
- **Never pre-build a base URL and concatenate.** Hosts append auth tokens as a query string, so `myApiUrl("/mypack/assets/icons/") + "play.svg"` yields `…/icons/?Auth=xxxplay.svg`. Always pass the complete tail to the helper.

Backend side: register routes with `@PromptServer.instance.routes.get("/mypack/api/...")` and namespace them under your pack name.

---

## 7. Monkey-patching discipline

Sometimes unavoidable (prototype behaviour, LiteGraph internals). Do it safely:

```js
beforeRegisterNodeDef(nodeType, nodeData) {
  if (!nodeData?.name || nodeType.prototype._myPackPatched) return;
  nodeType.prototype._myPackPatched = true;
  const orig = nodeType.prototype.onRemoved;
  nodeType.prototype.onRemoved = function () {
    try { myCleanup(this); } catch {}
    return orig?.apply(this, arguments);
  };
}
``

- Filter by `nodeData.category` prefix or an id prefix so a pack-wide default applies to all your nodes with **zero per-node boilerplate and no drift**:
  ```js
  if (!nodeData?.category?.startsWith("MyPack")) return;
  const orig = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function () {
    const ret = orig?.apply(this, arguments);
    if (!this.color)   this.color   = "#1d1d1d";
    if (!this.bgcolor) this.bgcolor = "#2a2a2a";
    return ret;
  };
  ```
- **Verify your hook is actually called** before building on it. Real example: patching `LGraphCanvas.prototype.processMouseMove` had *zero* effect in the Vue frontend because drag events are routed through `setPointerCapture`. The working hook was `window.addEventListener("pointermove", …)` in the **bubble** phase.
- **Cleanup must be centralized.** Registering a `closeFor` per node is useless if nothing calls it. Patch `onRemoved` once, centrally, and look the node up in your registry at removal time.

---

## 8. Nodes 2.0 (Vue/DOM renderer) compatibility

The renderer migration breaks assumptions in canvas-drawing widgets.

- **A DOM `<canvas>` widget goes blurry on zoom.** The Vue node is CSS-transform-scaled by `app.canvas.ds.scale`, but a canvas has a fixed backing store, so the browser stretches it. Size the backing store at `devicePixelRatio * zoom`, floored at `dpr` and capped on the long side (~6000 px).
- **`ResizeObserver` does not fire on graph zoom** — `clientWidth` in layout px is unchanged, only the CSS transform is. Run a cheap `requestAnimationFrame` loop that diffs the zoom each frame and repaints only on change; park the rAF id on the node and `cancelAnimationFrame` in `onRemoved`.
- **Detect the renderer** (`isVueNodes()`-style helper) and keep a survive/break matrix for your widgets rather than assuming.
- `beforeRegisterVueAppNodeDefs` is the Vue-side counterpart to `beforeRegisterNodeDef`.
- Some resize paths bypass `onResize` entirely — don't hang correctness on it alone.

---

## 9. Structure for a UI-heavy pack

Pixaroma at 135k JS LOC is organized as **one folder per feature**, each with `index.js` (the `registerExtension` call) and `.mjs` modules beside it, plus two shared layers:

```
js/
├── framework/     # design system: theme.mjs, components.mjs, layout.mjs, canvas.mjs
├── shared/        # cross-cutting: api_url.mjs, node_settings.mjs, floating_window.mjs,
│                  # graph_changed.mjs, nodes2.mjs, color_picker.mjs, utils.mjs
└── <feature>/     # one per feature: index.js + ui.mjs + api.mjs + css.mjs
```

Worth copying:

- **A `theme.mjs` with one `BRAND` constant** every feature imports — no colour drift.
- **Component factories** `createButton(text, {variant})` instead of ad-hoc `createElement`.
- **A CSS module per feature** owning its own constants, injected idempotently, so it doesn't matter which caller gets there first.
- **A node-settings registry** `registerNodeSettings(cls, def)` so the central toolbox and context-menu hooks can ask "does this node have settings?" rather than each node wiring itself.
- **Docs for the maths** — `docs/*.md` for non-obvious algorithms, referenced from the file header.

---

## 10. Anti-patterns

| Don't | Do |
|---|---|
| Copy JS into ComfyUI's `web/` directory | Export `WEB_DIRECTORY` from `__init__.py` |
| Root-relative `fetch("/mypack/x")` | `api.fetchApi("/mypack/x")` or `api.apiURL()` for bare fetch |
| Wrap `api.fetchApi` in your `apiURL` helper | It already prefixes — double prefix 404s under a sub-path |
| Assume `app.menu` exists in `setup()` | Bounded retry loop, then warn and stop |
| Un-mount chrome to hide it | Toggle a body class |
| Overwrite `nodeType.prototype.X` | Capture original, chain with `orig?.apply(this, arguments)` |
| Patch without an idempotency flag | `if (proto._myPackPatched) return` |
| Re-read a setting inside its own `onChange` | Use the `newValue` argument |
| One settings `category` leaf for several rows | One distinct leaf each |
| Assume a LiteGraph hook is called | Log-verify first — the Vue renderer bypasses several |
| Hardcode colours per feature file | One shared `BRAND`/theme module |
| Hide the button and lose the feature | Keep command + keybinding + context menu alive |
| Ship node UI with no keyboard path | Register a command for every UI action |

---

*This document is derived from official ComfyUI frontend sources (`Comfy-Org/ComfyUI_frontend` v1.50.2), battle-tested patterns in `pixaroma/ComfyUI-Pixaroma` v1.4.99 and `ComfyUI-Manager`, and the best-practices discussion (#2635) and Mintlify docs.*
