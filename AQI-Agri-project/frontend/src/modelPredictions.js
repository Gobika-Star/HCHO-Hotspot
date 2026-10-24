export function getStatePrediction(predictionData, state, year, month) {
  const patches = predictionData.filter(
    (row) =>
      row.state === state &&
      Number(row.year) === Number(year) &&
      Number(row.month) === Number(month)
  );
  if (!patches.length) return null;

  const probabilities = patches
    .map((row) => Number(row.predicted_probability))
    .filter(Number.isFinite);
  const probability = probabilities.length
    ? probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length
    : null;
  const hotspotPatchCount = patches.filter(
    (row) => Number(row.predicted_hotspot) === 1
  ).length;

  return {
    state,
    year: Number(year),
    month: Number(month),
    predicted_probability: probability,
    predicted_hotspot:
      hotspotPatchCount / patches.length >= 0.5 ? 1 : 0,
    hotspot_patch_count: hotspotPatchCount,
    patch_count: patches.length,
  };
}