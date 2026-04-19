// =====================================================================
// CODEC CONSTANTS
// =====================================================================
const SIG_ROWS=2,HEADER_BAND=8,HEADER_PIXELS=24,FOOTER_PIXELS=24,PIXELS_PER_BIT=3,RGB_THRESHOLD=128;

// =====================================================================
// ASSET RESOLUTION — packer injects INLINE_ASSETS before this script
// =====================================================================
function assetUrl(path) {
  return (typeof INLINE_ASSETS !== 'undefined' && INLINE_ASSETS[path]) || path;
}

// =====================================================================
// CELESTIAL READINGS
// =====================================================================
const READINGS = {
  sun:{Aries:'Born under a fire-starter sun. This image does not ask permission.',Taurus:'The sun held still. Built to last.',Gemini:'Twin-sun energy \u2014 says two things at once and means both.',Cancer:'The sun turned inward. Remembers something you forgot.',Leo:'Sun at full theater. Demands to be seen.',Virgo:'The sun measured twice. Every pixel deliberate.',Libra:'Sun in the scales. Trying to be fair to everyone in it.',Scorpio:'Sun in deep water. Knows more than it shows.',Sagittarius:'Sun aimed for the horizon. Going somewhere.',Capricorn:'Sun climbing the mountain. This image has ambition.',Aquarius:'Sun went sideways. Does not care about your expectations.',Pisces:'Sun dissolved. A feeling more than a place.'},
  moon:{'New Moon':'The moon was dark \u2014 emerged from total absence.','Waxing Crescent':'A sliver of intention. The moon was just beginning to commit.','First Quarter':'Half-lit. The moon was making a decision.','Waxing Gibbous':'Almost full. The moon was holding its breath.','Full Moon':'The moon was completely exposed. Nothing hidden.','Waning Gibbous':'The moon had just exhaled. Created in the afterglow.','Last Quarter':'Half the light was leaving. A sense of release.','Waning Crescent':'The last sliver. Born at the edge of disappearance.'},
  mercury:{Aries:'Mercury thinking fast, breaking things.',Taurus:'Mercury thinking slowly, meaning it.',Gemini:'Mercury was home. Prompt-to-pixel fidelity: maximum.',Cancer:'Mercury feeling the words instead of thinking them.',Leo:'Mercury being dramatic about the prompt.',Virgo:'Mercury editing. Every token weighed.',Libra:'Mercury negotiating between what you said and what you meant.',Scorpio:'Mercury reading between the lines.',Sagittarius:'Mercury paraphrasing freely. Creative license taken.',Capricorn:'Mercury following instructions to the letter.',Aquarius:'Mercury interpreting the prompt in a way nobody expected.',Pisces:'Mercury dreaming the prompt instead of reading it.'},
  venus:{Aries:'Venus wanted bold beauty. Subtlety not invited.',Taurus:'Venus was home. Aesthetic uncompromising.',Gemini:'Venus couldn\'t pick one vibe, picked two.',Cancer:'Venus reached for nostalgia.',Leo:'Venus demanded glamour.',Virgo:'Venus being particular about composition.',Libra:'Venus was home. Harmony non-negotiable.',Scorpio:'Venus went dark. Beauty with teeth.',Sagittarius:'Venus wanted the exotic.',Capricorn:'Venus being elegant. Restrained luxury.',Aquarius:'Venus went weird. An acquired taste.',Pisces:'Venus dissolved into pure atmosphere.'},
  mars:{Aries:'Mars was home and fully armed.',Taurus:'Mars slow but unstoppable.',Gemini:'Mars multitasking the GPU.',Cancer:'Mars protecting something.',Leo:'Mars performing. Main character energy.',Virgo:'Mars precise. Surgical generation.',Libra:'Mars trying diplomacy. Tension under the surface.',Scorpio:'Mars in the dark. Intensity was the only setting.',Sagittarius:'Mars aimed far. Ambitious render.',Capricorn:'Mars disciplined. Generation followed the plan.',Aquarius:'Mars rebelling against the prompt.',Pisces:'Mars fighting ghosts. Spectral energy.'},
  jupiter:{Aries:'Jupiter expanding recklessly.',Taurus:'Jupiter accumulating. Abundance in every pixel.',Gemini:'Jupiter multiplying ideas.',Cancer:'Jupiter nurturing. Grown like something tended.',Leo:'Jupiter amplifying. Everything turned up.',Virgo:'Jupiter optimizing. Expansion through refinement.',Libra:'Jupiter balancing growth.',Scorpio:'Jupiter going deep. Hidden layers.',Sagittarius:'Jupiter was home. Cosmic scope.',Capricorn:'Jupiter building structure.',Aquarius:'Jupiter innovating. Pushes the format.',Pisces:'Jupiter dreaming big. Transcends its medium.'},
  saturn:{Aries:'Saturn testing courage. Earned its existence.',Taurus:'Saturn demanding durability.',Gemini:'Saturn imposing clarity.',Cancer:'Saturn guarding boundaries.',Leo:'Saturn humbling the spotlight.',Virgo:'Saturn enforcing standards.',Libra:'Saturn weighing justice.',Scorpio:'Saturn in the deep. Constraints made it stronger.',Sagittarius:'Saturn limiting the horizon. Focus over freedom.',Capricorn:'Saturn was home. This image is load-bearing.',Aquarius:'Saturn restructuring reality.',Pisces:'Saturn dissolving limits.'},
};
const BODIES=[
  {k:'sun',s:'\u2609',n:'Sun'},
  {k:'moon',s:'\u263D',n:'Moon'},
  {k:'mercury',s:'\u263F',n:'Mercury'},
  {k:'venus',s:'\u2640',n:'Venus'},
  {k:'mars',s:'\u2642',n:'Mars'},
  {k:'jupiter',s:'\u2643',n:'Jupiter'},
  {k:'saturn',s:'\u2644',n:'Saturn'},
];

// =====================================================================
// CELESTIAL HELPERS
// =====================================================================
const ZODIAC_NAMES = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];

function parseDegrees(posStr) {
  if (!posStr) return null;
  const parts = posStr.split(' ');
  const sign = parts[0];
  const deg = parseFloat(parts[1]);
  const idx = ZODIAC_NAMES.indexOf(sign);
  if (idx < 0 || isNaN(deg)) return null;
  return idx * 30 + deg;
}

// =====================================================================
// CANVAS HELPERS
// =====================================================================
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  var words = text.split(' ');
  var lines = [];
  var line = '';
  for (var i = 0; i < words.length; i++) {
    var test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function font(weight, size, italic) {
  return (italic ? 'italic ' : '') + weight + ' ' + size + 'px "JetBrains Mono", monospace';
}
function symFont(weight, size) {
  return weight + ' ' + size + 'px "Symbols Nerd Font", "Apple Symbols", serif';
}

// =====================================================================
// BIRTH TRAIT DEFINITIONS — icons, display names, tooltips
// =====================================================================
var BIRTH_TRAITS = {
  // CPU contention — silver
  contested:      { name: 'Contested',      cat: 'CPU',    metal: 'silver', desc: 'Threads jostling at the moment of birth' },
  yielding:       { name: 'Yielding',       cat: 'CPU',    metal: 'silver', desc: 'A brief window of cooperation' },
  uncontested:    { name: 'Uncontested',    cat: 'CPU',    metal: 'silver', desc: 'A calm moment between storms' },
  // Memory faults — bronze
  stumbling:      { name: 'Stumbling',      cat: 'Memory', metal: 'bronze', desc: 'A page fault at the exact moment of conception' },
  sure_footed:    { name: 'Sure-footed',    cat: 'Memory', metal: 'silver', desc: 'The memory was aligned' },
  reaching:       { name: 'Reaching',       cat: 'Memory', metal: 'silver', desc: 'Hard faults echoed through the birth' },
  // Speculation — bronze/gold
  speculative:    { name: 'Speculative',    cat: 'OS',     metal: 'bronze', desc: 'The OS was racing ahead of the program' },
  cautious:       { name: 'Cautious',       cat: 'OS',     metal: 'bronze', desc: 'Taking no risks with memory' },
  restless:       { name: 'Restless',       cat: 'OS',     metal: 'silver', desc: 'Speculating but unsure' },
  // Purgeable pages — bronze/gold
  loosening_grip: { name: 'Loosening Grip', cat: 'Pages',  metal: 'gold',   desc: 'The machine was letting go of memory' },
  holding_tight:  { name: 'Holding Tight',  cat: 'Pages',  metal: 'bronze', desc: 'Every page was precious, nothing to spare' },
  // File descriptors — gold
  entangled:      { name: 'Entangled',      cat: 'I/O',    metal: 'gold',   desc: 'File descriptors aligned at a round number' },
  unraveled:      { name: 'Unraveled',      cat: 'I/O',    metal: 'silver', desc: 'The connections were fraying at the edges' },
  // Load — silver
  under_pressure: { name: 'Under Pressure', cat: 'Load',   metal: 'silver', desc: 'The system was straining' },
  // Time — gold
  night_owl:      { name: 'Night Owl',      cat: 'Time',   metal: 'silver', desc: 'The world was asleep' },
  dawn:           { name: 'Dawn',           cat: 'Time',   metal: 'gold',   desc: 'Born at first light' },
};
