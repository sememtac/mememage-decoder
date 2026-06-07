// =====================================================================
// RARITY HELPERS — reconstruct derived rarity fields from the dice dict.
// =====================================================================
// Records store the rarity dice rolls themselves (rarity.celestial,
// .machine, .entropy, .machine_signature, .sigil). The aggregate
// rarity_score used to be persisted alongside, but it's a pure sum
// of those components — readers reconstruct it via RarityScore.compute.
//
// Mirror of mememage/rarity.py's score computation. When the scoring
// algorithm changes in Python, mirror it here.
// =====================================================================

(function (root) {
  function compute(rarity) {
    if (!rarity) return 0;
    var sum = 0;
    ['celestial', 'machine', 'entropy'].forEach(function (group) {
      var arr = rarity[group];
      if (!arr) return;
      for (var i = 0; i < arr.length; i++) {
        var t = arr[i];
        if (t && typeof t.points === 'number') sum += t.points;
      }
    });
    if (typeof rarity.machine_signature === 'number') sum += rarity.machine_signature;
    if (rarity.sigil && typeof rarity.sigil.points === 'number') sum += rarity.sigil.points;
    if (sum < 0) sum = 0;
    if (sum > 255) sum = 255;
    return sum;
  }

  // Convenience wrapper: read .rarity_score off the record (V4-era
  // back-compat for any legacy test souls still floating around) OR
  // compute from .rarity dict (V1 records).
  function fromRecord(record) {
    if (!record) return 0;
    if (typeof record.rarity_score === 'number') return record.rarity_score;
    return compute(record.rarity);
  }

  root.RarityScore = { compute: compute, fromRecord: fromRecord };
})(typeof window !== 'undefined' ? window : this);
