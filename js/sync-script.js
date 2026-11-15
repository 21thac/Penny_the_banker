// The script that runs inside the user's own Google Sheet and does the server
// half of sync. Settings hands it to the user, with their sync code filled in,
// to paste into Extensions > Apps Script. It deliberately uses plain, older
// JavaScript with no backticks so it can live inside this file as text.

const SCRIPT = String.raw`/**
 * Ledger sync.
 *
 * 1. In your Google Sheet: Extensions > Apps Script. Replace everything there
 *    with this file and press Save.
 * 2. Deploy > New deployment > type "Web app".
 *    Execute as: Me.   Who has access: Anyone.
 * 3. Copy the Web app URL into Ledger > Settings > Sync.
 *
 * Only requests that carry the sync code below are accepted.
 */
var SYNC_CODE = '__SYNC_CODE__';

// Every tab starts with these hidden columns; the readable ones follow.
var SYSTEM = ['id', 'updatedAt', 'syncedAt', 'deleted', 'json'];
var TABS = ['entries', 'categories', 'holdings', 'moves', 'valuations', 'goals', 'settings'];

function doGet() {
  return reply({ ok: true, app: 'ledger-sync' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var req = JSON.parse(e.postData.contents);
    if (req.code !== SYNC_CODE) return reply({ ok: false, error: 'wrong-code' });
    if (req.action === 'ping') return reply({ ok: true, records: countRecords() });
    if (req.action === 'sync') return reply(sync(req));
    if (req.action === 'putPhoto') return reply(putPhoto(req));
    if (req.action === 'getPhoto') return reply(getPhoto(req));
    return reply({ ok: false, error: 'unknown-action' });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function tabName(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Find a tab, creating it (with its header row) the first time.
function tab(name, headers) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(tabName(name));
  if (!sheet) {
    sheet = book.insertSheet(tabName(name));
    sheet.getRange('A:A').setNumberFormat('@');
    sheet.getRange('E:E').setNumberFormat('@');
  }
  if (sheet.getLastRow() === 0 || (headers && headers.length)) {
    var all = SYSTEM.concat(headers || []);
    sheet.getRange(1, 1, 1, all.length).setValues([all]);
    sheet.setFrozenRows(1);
    sheet.hideColumns(1, SYSTEM.length);
  }
  return sheet;
}

function systemRows(sheet) {
  var last = sheet.getLastRow();
  return last > 1 ? sheet.getRange(2, 1, last - 1, SYSTEM.length).getValues() : [];
}

function countRecords() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var total = 0;
  TABS.forEach(function (name) {
    var sheet = book.getSheetByName(tabName(name));
    if (sheet) total += Math.max(0, sheet.getLastRow() - 1);
  });
  return total;
}

// Take the app's changes, keep whichever copy of each record is newer, and
// send back everything that changed here since the app last asked.
function sync(req) {
  var now = Date.now();
  var since = Number(req.since || 0);
  var records = {};
  TABS.forEach(function (name) {
    var incoming = (req.changes && req.changes[name]) || {};
    var sheet = tab(name, incoming.headers);
    var rows = systemRows(sheet);
    var at = {};
    rows.forEach(function (r, i) { at[String(r[0])] = i; });

    var fresh = [];
    var written = {};
    (incoming.rows || []).forEach(function (row) {
      var values = [String(row.id), Number(row.updatedAt) || 0, now, row.deleted ? 'yes' : '', row.json].concat(row.cols || []);
      var i = at[String(row.id)];
      if (i === undefined) {
        at[String(row.id)] = rows.length + fresh.length;
        fresh.push(values);
        written[String(row.id)] = true;
      } else if (i < rows.length && values[1] > Number(rows[i][1])) {
        sheet.getRange(i + 2, 1, 1, values.length).setValues([values]);
        rows[i] = values;
        written[String(row.id)] = true;
      }
    });
    if (fresh.length) {
      var width = SYSTEM.length;
      fresh.forEach(function (v) { width = Math.max(width, v.length); });
      fresh.forEach(function (v) { while (v.length < width) v.push(''); });
      sheet.getRange(sheet.getLastRow() + 1, 1, fresh.length, width).setValues(fresh);
    }

    records[name] = rows
      .filter(function (r) { return Number(r[2]) > since && !written[String(r[0])]; })
      .map(function (r) { return String(r[4]); });
  });
  return { ok: true, serverTime: now, records: records };
}

// Photos are saved as files in a "Ledger photos" folder in your Drive.
function photoFolder() {
  var found = DriveApp.getFoldersByName('Ledger photos');
  return found.hasNext() ? found.next() : DriveApp.createFolder('Ledger photos');
}

function findPhoto(sheet, id) {
  var rows = systemRows(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) return JSON.parse(rows[i][4]);
  }
  return null;
}

function putPhoto(req) {
  var sheet = tab('photos', ['Link']);
  var have = findPhoto(sheet, req.id);
  if (have) return { ok: true, url: have.url };
  var parts = String(req.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!parts) return { ok: false, error: 'bad-photo' };
  var blob = Utilities.newBlob(Utilities.base64Decode(parts[2]), parts[1], req.id + '.jpg');
  var file = photoFolder().createFile(blob);
  var info = { fileId: file.getId(), url: file.getUrl() };
  var now = Date.now();
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setValues([[String(req.id), now, now, '', JSON.stringify(info), info.url]]);
  return { ok: true, url: info.url };
}

function getPhoto(req) {
  var have = findPhoto(tab('photos', ['Link']), req.id);
  if (!have) return { ok: false, error: 'no-photo' };
  var blob = DriveApp.getFileById(have.fileId).getBlob();
  return { ok: true, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}
`;

export const syncScript = (code) => SCRIPT.replace('__SYNC_CODE__', code);
