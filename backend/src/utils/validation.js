function parsePositiveInteger(value) {
  const normalizedValue = String(value ?? "").trim();

  if (!/^[1-9]\d*$/.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  return Number.isSafeInteger(parsedValue) ? parsedValue : null;
}

module.exports = {
  parsePositiveInteger,
};
