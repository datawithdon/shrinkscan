# ShrinkScan

Scan a grocery barcode and find out whether the package got smaller.
ShrinkScan checks the product's size history in
[Open Food Facts](https://world.openfoodfacts.org), looks for a bigger version
of the same product, reads the shelf-tag price with your camera, and suggests
Canadian store-brand alternatives.

**Live app:** https://datawithdon.github.io/shrinkscan/

It's a static web app with no account and no server. Your prices and lists
stay in your browser.

## How it decides "shrunk"

Every edit of an Open Food Facts product page is a numbered revision, so you
might expect to read a barcode's history and spot the size dropping. In
practice that rarely happens. A test of 12 popular North American products
(about 120 sampled revisions) found **no** real size drops. The one change was
a data cleanup (`"1"` → `500 mL`).

The reason is GS1's barcode rules. When the declared net contents change, the
product normally gets a **new barcode**. So a shrunk package shows up as a
separate product, and the old, bigger one keeps its own entry.

That's why ShrinkScan checks three things:

1. **This barcode's edit history.** It samples revisions evenly, then bisects
   between any two that disagree to pin down when the size changed. Each
   revision is cached for good, and the number of reads is set in Settings.
   Changes of 2× or more, or from grams to millilitres, count as data fixes.
   A bonus pack that goes back to its normal size isn't counted as a shrink.
2. **Same-brand size twins.** It searches for Canadian products of the same
   brand and category with a near-identical name. If one is up to 25% bigger,
   this product is flagged "Possibly shrunk", with a note when the bigger one
   was added to the database first. Bigger gaps are listed as other pack sizes
   (family packs, minis).
3. **Your own prices.** Log a price from the shelf tag and ShrinkScan computes
   the price per 100 g or 100 mL. Logs before and after a size change show
   "same price, less product". Two regular-price logs of the same barcode show
   price creep. Sale prices are left out of that comparison.

The verdict lists every reason behind it, so you can judge it yourself.

## Features

- **Live barcode scanning** with the rear camera. It uses the native
  `BarcodeDetector` where the browser has one, and a vendored zxing-wasm
  decoder in a worker everywhere else (iOS Safari, Firefox). Every read must
  pass its GS1 check digit, and the same code must be read twice in a row.
  You can also pick a photo or type the digits.
- **Shelf-tag OCR** on the device (Tesseract.js). It reads the selling price
  and the printed unit price, in English or French, including `$0.70 /100 g`,
  `0,70 $ / 100 g`, `/kg`, `/L`, `/lb`, `2/$5` and the big-dollars-small-cents
  "3 99" layout. When the tag's unit price doesn't match the package size on
  record, the app warns you. That's often a sign the package changed.
- **My shrunk list** of flagged products, with store-brand alternatives:
  President's Choice, No Name (Loblaw), Compliments (Sobeys), Selection and
  Irresistibles (Metro), Great Value (Walmart), Kirkland Signature (Costco)
  and Life Smart (Shoppers).
- **Price log** with CSV export. JSON backup and restore. Works offline as an
  installable PWA, with lookups cached.

## The data and its limits

- Open Food Facts is crowd-sourced. Coverage of Canadian products is patchy,
  and many entries have no size. When a barcode isn't there, the app links you
  to add it.
- OFF's published rate limits are 100 product reads and 10 searches per minute.
  ShrinkScan paces its requests below those limits and backs off when OFF says
  it's busy. A first lookup reads up to 18 revisions (about 12 seconds).
  Repeat lookups come from the cache.
- Prices are only the ones you log. Nothing is crowd-shared in this version.

## Run locally

```sh
python3 -m http.server 8000 --bind 127.0.0.1   # then open http://127.0.0.1:8000
npm test                                       # node --test, no dependencies
```

The camera needs `https://` or `localhost`.

## Stack

Vanilla JS modules, no build step, no npm dependencies. Vendored: Tesseract.js 7
(OCR) and zxing-wasm 3.1.6 (barcodes). No analytics or trackers. The only
outside host is the Open Food Facts API, and no product photos are loaded.
See [`vendor/`](vendor/) and [SECURITY.md](SECURITY.md).

Product data © Open Food Facts contributors, under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
Code under the MIT license.
