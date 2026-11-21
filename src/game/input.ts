// Keyboard and trackpad/mouse. State is polled by the game each frame; no events reach React.
export const input = {
  fwd: 0, turn: 0, strafe: 0, run: false,
  lookX: 0, lookY: 0, // accumulated drag since last frame
  zoom: 0,
  hold: false, // Space / E held: "take hold"
  film: false, // F held: the boy's camera
  pressed: new Set<string>(), // keys that went down this frame
  keys: new Set<string>(),
  dragging: false,
  enabled: true,
  anyKey: false,
}
let installed = false
export function installInput(el: HTMLElement) {
  if (installed) return
  installed = true
  const down = (e: KeyboardEvent) => {
    if (e.repeat) return
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    input.keys.add(k); input.pressed.add(k); input.anyKey = true
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault()
  }
  const up = (e: KeyboardEvent) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; input.keys.delete(k) }
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', () => { input.keys.clear(); input.dragging = false })
  el.addEventListener('pointerdown', (e) => { input.dragging = true; el.setPointerCapture(e.pointerId) })
  el.addEventListener('pointerup', (e) => { input.dragging = false; try { el.releasePointerCapture(e.pointerId) } catch { /* fine */ } })
  el.addEventListener('pointermove', (e) => { if (input.dragging) { input.lookX += e.movementX; input.lookY += e.movementY } })
  // two-finger trackpad scroll turns the camera too (and pinch / ctrl-wheel zooms)
  el.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (e.ctrlKey) input.zoom += e.deltaY * 0.01
    else { input.lookX -= e.deltaX * 0.6; input.zoom += e.deltaY * 0.0025 }
  }, { passive: false })
  el.addEventListener('contextmenu', (e) => e.preventDefault())
}
export function pollInput() {
  const k = input.keys
  const on = (a: string, b: string) => (k.has(a) || k.has(b) ? 1 : 0)
  input.fwd = on('w', 'ArrowUp') - on('s', 'ArrowDown')
  input.strafe = on('d', 'ArrowRight') - on('a', 'ArrowLeft')
  input.run = k.has('Shift')
  input.hold = k.has(' ') || k.has('e')
  input.film = k.has('f')
  if (!input.enabled) { input.fwd = 0; input.strafe = 0; input.hold = false; input.film = false }
}
export function endFrameInput() { input.pressed.clear(); input.lookX = 0; input.lookY = 0; input.zoom = 0; input.anyKey = false }
