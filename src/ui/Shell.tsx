import { useUI } from '../state';

export function Shell() {
  const ui = useUI();
  return (
    <div style={{ position: 'fixed', left: 12, top: 10, font: '12px ui-monospace, monospace', opacity: 0.8, pointerEvents: 'none' }}>
      {ui.mode === 'loading' ? `${ui.loading.stage} ${(ui.loading.f * 100) | 0}%` : ui.backend}
    </div>
  );
}
