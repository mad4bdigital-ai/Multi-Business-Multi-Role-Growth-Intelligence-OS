export function headerMap(headerRow, sheetName = "unknown_sheet") {
  const map = {};
  const duplicates = [];

  headerRow.forEach((rawName, idx) => {
    const name = String(rawName || "").trim();
    if (!name) return;

    if (Object.prototype.hasOwnProperty.call(map, name)) {
      duplicates.push(name);
      return;
    }

    map[name] = idx;
  });

  if (duplicates.length) {
    const err = new Error(
      `Duplicate headers detected in ${sheetName}: ${[...new Set(duplicates)].join(", ")}`
    );
    err.code = "duplicate_sheet_headers";
    err.status = 500;
    throw err;
  }

  return map;
}

export function getCell(row, map, key) {
  const idx = map[key];
  return idx === undefined ? "" : (row[idx] ?? "");
}
