// The hand-printed fonts the user can switch between in Settings.
// The matching CSS (family, size and weight per font) lives in styles.css
// under :root[data-font="…"].

export const FONTS = [
  { id: 'coming-soon', name: 'Coming Soon', family: "'Coming Soon'" },
  { id: 'short-stack', name: 'Short Stack', family: "'Short Stack'" },
  { id: 'architects', name: 'Architects Daughter', family: "'Architects Daughter'" },
  { id: 'playpen', name: 'Playpen Sans', family: "'Playpen Sans'" },
];

export const DEFAULT_FONT = FONTS[0].id;

export function applyFont(id) {
  const font = FONTS.find((f) => f.id === id) ? id : DEFAULT_FONT;
  document.documentElement.dataset.font = font;
}
