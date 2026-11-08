// Settings: history depth, backup/restore, delete everything, about the data.

import { download, h, mount, toast } from "../dom.js";
import { off } from "../off.js";
import { deleteAll, exportState, replaceAll, setSetting, state } from "../store.js";

const MAX_IMPORT = 5 * 1024 * 1024;

export function render(root) {
  const depth = h("select", { id: "depth", onchange: (e) => { setSetting("depth", e.target.value); toast("Saved"); } },
    [["quick", "Quick: 8 reads per product"], ["normal", "Normal: up to 18 reads"], ["deep", "Deep: up to 40 reads (slower)"]]
      .map(([v, t]) => h("option", { value: v, selected: state.settings.depth === v }, t)));

  const file = h("input", { type: "file", accept: "application/json,.json", class: "visually-hidden", id: "import", onchange: async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_IMPORT) { toast("That file is too big to be a ShrinkScan backup."); return; }
    try {
      const data = JSON.parse(await f.text());
      if (data?.app !== "shrinkscan") throw new Error("not ours");
      if (!confirm("Replace everything on this device with the backup?")) return;
      replaceAll(data);
      toast(`Restored ${state.prices.length} prices and ${state.shrunk.length} flagged products`);
    } catch {
      toast("That isn't a ShrinkScan backup.");
    }
  } });

  mount(root, h("section", { class: "panel narrow" },
    h("h1", {}, "Settings"),
    h("label", { for: "depth" }, "Size-history depth"), depth,
    h("p", { class: "muted small" }, "Each read fetches one old revision of the product page. Open Food Facts allows about 100 reads a minute, and revisions are cached on this device, so a product only costs this once."),

    h("h2", {}, "Your data"),
    h("p", { class: "muted" }, `${state.prices.length} prices · ${state.shrunk.length} on your shrunk list · ${Object.keys(state.products).length} products seen. Stored only in this browser.`),
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", onclick: () => download(`shrinkscan-backup-${new Date().toLocaleDateString("en-CA")}.json`, JSON.stringify(exportState(), null, 1), "application/json") }, "Download backup"),
      h("label", { class: "btn", for: "import" }, "Restore backup"), file,
      h("button", { class: "btn", type: "button", onclick: () => { off.clearCache(); toast("Open Food Facts cache cleared"); } }, "Clear lookup cache"),
      h("button", { class: "btn danger", type: "button", onclick: () => {
        if (!confirm("Delete all your prices, your shrunk list and scan history from this device?")) return;
        deleteAll(); off.clearCache(); toast("Everything deleted"); render(root);
      } }, "Delete all data")),

    h("h2", {}, "Where the data comes from"),
    h("ul", { class: "plain" },
      h("li", {}, "Product names, sizes and edit history: ", h("a", { href: "https://world.openfoodfacts.org", target: "_blank", rel: "noopener noreferrer" }, "Open Food Facts ↗"), ", a crowd-sourced open database (ODbL). Coverage of Canadian products is patchy, and sizes are typed in by volunteers, so the app treats any size change of 2× or more, or a switch between grams and millilitres, as a data correction rather than a shrink."),
      h("li", {}, "Prices: only the ones you log. Nothing is shared or uploaded."),
      h("li", {}, "Shrinks are found two ways. One is this barcode's own edit history. The other is a same-brand product up to 25% bigger, because under GS1 rules a change in net contents usually means a new barcode."),
      h("li", {}, "Store brands: President's Choice, PC Organics, PC Blue Menu, No Name (Loblaw), Life Smart (Shoppers Drug Mart), Compliments (Sobeys), Selection, Irresistibles (Metro), Great Value (Walmart) and Kirkland Signature (Costco).")),
    h("p", { class: "muted small" }, "ShrinkScan isn't affiliated with Open Food Facts or any retailer.")));
}
