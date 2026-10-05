import { inputClass, Segmented } from './ui.tsx';
import { PRESETS, type Preset, type RangeValue } from '../lib/range.ts';

export function RangeSelector({ value, onChange, min, max, compact }: { value: RangeValue; onChange: (v: RangeValue) => void; min?: string | null; max?: string | null; compact?: boolean }) {
  const presets = compact ? PRESETS.filter((p) => p !== 'Custom') : PRESETS;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<Preset> label="Date range" value={value.preset} onChange={(p) => onChange({ ...value, preset: p })} options={presets.map((p) => ({ value: p, label: p }))} />
      {value.preset === 'Custom' && (
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="date"
            aria-label="From"
            className={`${inputClass} num h-7 w-36`}
            value={value.from ?? ''}
            min={min ?? undefined}
            max={value.to ?? max ?? undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
          />
          to
          <input
            type="date"
            aria-label="To"
            className={`${inputClass} num h-7 w-36`}
            value={value.to ?? ''}
            min={value.from ?? min ?? undefined}
            max={max ?? undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
          />
        </span>
      )}
    </div>
  );
}
