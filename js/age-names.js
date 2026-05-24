// =====================================================================
// AGE NAMES — display-side mapping for the integer `age` field.
// =====================================================================
// Records carry `age: 1..12` (an int) at the top level. The human
// label (e.g. "Age of Aries") is reconstructed at display time via
// this 12-element lookup — same pattern as birth-text.js for trait
// codes and the inline BAYER table for constellation_index.
//
// Mirror of mememage/site_embed.py's AGE_NAMES tuple. APPEND-ONLY:
// the position of each entry is the Age number minus 1, and that
// number is committed inside records as `age`. Reordering would
// mute or re-label historical records.
// =====================================================================

(function (root) {
  var AGE_NAMES = [
    'Age of Aries',       // 1
    'Age of Taurus',      // 2
    'Age of Gemini',      // 3
    'Age of Cancer',      // 4
    'Age of Leo',         // 5
    'Age of Virgo',       // 6
    'Age of Libra',       // 7
    'Age of Scorpio',     // 8
    'Age of Sagittarius', // 9
    'Age of Capricorn',   // 10
    'Age of Aquarius',    // 11
    'Age of Pisces',      // 12
  ];

  function ageName(n) {
    if (typeof n !== 'number' || n < 1 || n > AGE_NAMES.length) return '';
    return AGE_NAMES[n - 1];
  }

  root.AgeNames = { LIST: AGE_NAMES, name: ageName };
})(typeof window !== 'undefined' ? window : this);
