// Small helpers the two pages share. Everything goes on the page through
// textContent, so a player's name can't turn into markup on someone's screen.

// h('p.muted', 'Hello'), h('ul', {}, [items]), h('button', { onclick }, 'Go')
export function h(spec, attrs, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length > 0) node.className = classes.join(' ');
  const hasAttrs = attrs && typeof attrs === 'object' && !Array.isArray(attrs) && !(attrs instanceof Node);
  if (hasAttrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value === null || value === undefined) continue;
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'style') Object.assign(node.style, value);
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
  } else if (attrs !== undefined && attrs !== null) {
    children.unshift(attrs);
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

// Redraws `parent` only when what it shows changed. Views arrive whenever anyone
// does anything, and swapping a button out from under a finger loses the tap.
export function draw(parent, content, build) {
  const key = JSON.stringify(content);
  if (parent.dataset.drawn === key) return;
  parent.dataset.drawn = key;
  parent.replaceChildren(...[build()].flat(Infinity).filter(Boolean));
}

export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

export const dot = (color) => h('span.dot', { style: { background: color } });

// ---- Looks: the host's colour, skin and tag for a player's ball -----------
// The skins are the game's (shared/looks.ts lists the same ids). Each has a name
// for the picker, a CSS background for its dot, the colour the game gives the
// name above the ball, and a tag it suggests.
export const SKIN_LOOKS = {
  gold: { name: 'Dev orb', tag: 'DEV', label: '#ffd23f', dot: () => 'radial-gradient(circle at 35% 30%, #fffbe0, #ffd94a 35%, #b8860b)' },
  birthday: {
    name: 'Birthday', tag: 'B-DAY', label: '#ff8fd8',
    dot: (color) => `radial-gradient(circle at 30% 35%, #ffd23f 0 9%, transparent 10%), radial-gradient(circle at 68% 58%, #5ce1ff 0 9%, transparent 10%), radial-gradient(circle at 58% 26%, #7cff6b 0 8%, transparent 9%), radial-gradient(circle at 35% 72%, #ff5c8a 0 8%, transparent 9%), ${color}`,
  },
  rainbow: { name: 'Rainbow', tag: null, label: '#ffffff', dot: () => 'conic-gradient(hsl(0 90% 62%), hsl(60 90% 62%), hsl(120 90% 62%), hsl(180 90% 62%), hsl(240 90% 62%), hsl(300 90% 62%), hsl(360 90% 62%))' },
  galaxy: { name: 'Galaxy', tag: null, label: '#c9a7ff', dot: () => 'radial-gradient(circle at 30% 30%, #fff 0 4%, transparent 5%), radial-gradient(circle at 65% 60%, #fff 0 3%, transparent 4%), radial-gradient(circle at 40% 40%, #5b2a9e, #24135a 55%, #0a0820)' },
  diamond: { name: 'Diamond', tag: 'VIP', label: '#a8f0ff', dot: () => 'radial-gradient(circle at 35% 30%, #ffffff, #c8f6ff 40%, #4aa8c8)' },
  fire: { name: 'Fire', tag: 'HOT', label: '#ffb347', dot: () => 'radial-gradient(circle at 50% 55%, #fff6c8, #ffd23f 35%, #ff7a1a 75%, #c2290a)' },
};

const LOOK_COLORS = ['#e5484d', '#f76b15', '#ffb224', '#46a758', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#ff8fd8', '#a18072', '#757575'];

// A dot's background for a player ({ color, skin }).
export const lookBackground = (p) => SKIN_LOOKS[p.skin]?.dot(p.color) ?? p.color;

// "DEV · Ana", or just the name.
export const tagged = (p) => (p.tag ? `${p.tag} · ${p.name}` : p.name);

// The host's button beside a player: opens the picker. `save(look)` sends it.
export function lookButton(p, save) {
  const dressed = Boolean(p.skin || p.tag);
  return h(`button.button.look-button${dressed ? '.on' : ''}`, {
    type: 'button',
    title: 'Colour, skin and tag for this ball. Looks only.',
    onclick: () => openLookPicker(p, save),
  }, dressed ? `★ ${SKIN_LOOKS[p.skin]?.name ?? p.tag}` : '★ Style');
}

// A dialog, outside the redrawn lists, so typing a tag survives every update.
function openLookPicker(p, save) {
  const look = { color: p.color, skin: p.skin ?? null, tag: p.tag ?? '' };
  const suggested = new Set(Object.values(SKIN_LOOKS).map((s) => s.tag).filter(Boolean));
  const preview = h('.look-preview');
  const tagInput = h('input.input', { value: look.tag, maxLength: 12, placeholder: 'None', autocomplete: 'off', oninput: (e) => { look.tag = e.target.value; refresh(); } });
  const colorInput = h('input.look-custom', { type: 'color', value: look.color, 'aria-label': 'Any colour', oninput: (e) => { look.color = e.target.value; refresh(); } });
  const swatches = h('.look-swatches');
  const skins = h('.look-skins');

  function choose(skin) {
    // Swap the suggested tag along with the skin, but never one the host typed.
    if (!look.tag.trim() || suggested.has(look.tag.trim())) look.tag = SKIN_LOOKS[skin]?.tag ?? '';
    look.skin = skin;
    tagInput.value = look.tag;
    refresh();
  }

  function refresh() {
    const skin = SKIN_LOOKS[look.skin];
    preview.replaceChildren(
      h('span.look-ball', { style: { background: lookBackground(look) } }),
      h('span.look-name', { style: { color: skin?.label ?? 'var(--text)' } }, tagged({ name: p.name, tag: look.tag.trim() })));
    swatches.replaceChildren(
      ...LOOK_COLORS.map((c) => h(`button.look-swatch${c === look.color ? '.on' : ''}`, { type: 'button', style: { background: c }, 'aria-label': c, onclick: () => { look.color = c; colorInput.value = c; refresh(); } })),
      colorInput);
    skins.replaceChildren(
      h(`button.look-skin${look.skin === null ? '.on' : ''}`, { type: 'button', onclick: () => choose(null) }, h('span.dot', { style: { background: look.color } }), 'Plain'),
      ...Object.entries(SKIN_LOOKS).map(([id, s]) =>
        h(`button.look-skin${look.skin === id ? '.on' : ''}`, { type: 'button', onclick: () => choose(id) }, h('span.dot', { style: { background: s.dot(look.color) } }), s.name)));
  }

  const dialog = h('dialog.look-dialog', { onclose: () => dialog.remove() },
    h('form.stack', { method: 'dialog', onsubmit: () => save({ color: look.color, skin: look.skin, tag: look.tag.trim() || null }) },
      h('.eyebrow', `Style ${p.name}`),
      preview,
      h('.look-field', {}, h('span', 'Colour'), swatches),
      h('.look-field', {}, h('span', 'Skin'), skins),
      h('label.look-field', {}, h('span', 'Tag before the name'), tagInput),
      h('p.muted', 'Looks only, from the next fight.'),
      h('.look-actions', {},
        h('button.button.quiet', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
        h('button.button.primary', { type: 'submit' }, 'Save'))));
  refresh();
  document.body.append(dialog);
  dialog.showModal();
}

// Keeps one arena frame in `host` and only reloads it when `src` changes. The
// text over it counts down to `endsAt` (Date.now() time); null removes it.
export function arena(host) {
  let frame = null;
  let shown = null;
  let onLoad = () => {};
  const number = h('div.countdown-number');
  const label = h('div.muted');
  const overlay = h('div.countdown', {}, number, label);
  overlay.hidden = true;
  let endsAt = null;
  setInterval(tick, 200);

  function tick() {
    overlay.hidden = endsAt === null;
    if (endsAt !== null) number.textContent = String(Math.max(1, Math.ceil((endsAt - Date.now()) / 1000)));
  }

  return {
    set(src, { countdownMs = 0, text = '' } = {}) {
      if (src !== shown) {
        shown = src;
        frame?.remove();
        frame = null;
        if (src) {
          frame = h('iframe', { src, title: 'The arena', allow: 'autoplay' });
          frame.addEventListener('load', () => onLoad(frame));
          host.prepend(frame);
        }
      }
      host.hidden = !src;
      if (!host.contains(overlay)) host.append(overlay);
      endsAt = countdownMs > 0 ? Date.now() + countdownMs : null;
      label.textContent = text;
      tick();
    },
    onLoad(fn) {
      onLoad = fn;
    },
  };
}

// A player's build as tags: the weapon, then each pick once with its count
// ("Sharpened ×2"). Hovering a tag, or tapping it on a phone, shows what it
// does under the tags, for all its copies together. Null before a weapon is chosen.
export function buildTags(draft) {
  if (!draft.weapon) return null;
  const detail = h('p.tag-detail', { hidden: true });
  let pinned = null; // the tag tapped last, shown when nothing is hovered
  const show = (tag) => {
    detail.hidden = !tag;
    if (tag) detail.replaceChildren(h('strong', tag.dataset.name), ` ${tag.dataset.description}`);
  };
  const tag = (item, lead) => {
    const label = item.count > 1 ? `${item.name} ×${item.count}` : item.name;
    if (!item.description) return h(lead ? 'li.lead' : 'li', label);
    const node = h(`li.has-detail${lead ? '.lead' : ''}`, { tabIndex: 0, 'data-name': label, 'data-description': item.description }, label);
    node.addEventListener('mouseenter', () => show(node));
    node.addEventListener('mouseleave', () => show(pinned));
    node.addEventListener('click', () => {
      pinned = pinned === node ? null : node;
      for (const other of node.parentNode.children) other.classList.toggle('pinned', other === pinned);
      show(pinned);
    });
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        node.click();
      }
    });
    return node;
  };
  return h('div', {}, h('ul.tags', {}, tag(draft.weapon, true), draft.picks.map((p) => tag(p, false))), detail);
}
