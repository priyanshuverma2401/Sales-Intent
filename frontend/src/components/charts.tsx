import React from 'react';
import { useThemeStore } from '../store/themeStore';
import { cx } from './ui';

/* ---------------------------------------------------------------------------
   Chart palette

   Not picked by eye. Both columns were run through the data-viz validator
   against this app's real chart surfaces - #ffffff in light, #161e2e in dark -
   and both pass the lightness band, the chroma floor, adjacent colour-blind
   separation and the normal-vision floor:

     light  worst adjacent pair ΔE 9.1 (protan) / 22.9 (normal vision)
     dark   worst adjacent pair ΔE 8.4 (protan) / 19.8 (normal vision)

   Slot 1 is the product blue so a chart reads as part of the app rather than as
   a widget dropped into it. In light mode slots 3 and 4 sit below 3:1 against
   white, so they are only ever used on bars that carry a printed value beside
   them - the number, not the hue, is what has to be readable.

   `ordinal` is a single-hue ramp for genuinely ordered buckets (fit-score
   bands). Never used for nominal categories: colouring bars darker-where-bigger
   would spend the only free channel restating the bar length.

   `status` is reserved for good/attention/failed and never doubles as a series
   colour. It always ships with a word next to it, never colour alone.
   --------------------------------------------------------------------------- */
export interface ChartPalette {
  /** Categorical identity slots, assigned in this fixed order and never cycled. */
  series: string[];
  /** Single-hue ramp for genuinely ordered buckets. */
  ordinal: string[];
  status: { good: string; warning: string; critical: string };
  grid: string;
  axis: string;
  surface: string;
}

const PALETTES: Record<'light' | 'dark', ChartPalette> = {
  light: {
    series: ['#2563eb', '#eb6834', '#1baf7a', '#eda100'],
    ordinal: ['#86b6ef', '#5598e7', '#2a78d6', '#184f95'],
    status: { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' },
    grid: '#e6ebf2',
    axis: '#94a3b8',
    surface: '#ffffff',
  },
  dark: {
    series: ['#3987e5', '#d95926', '#199e70', '#c98500'],
    ordinal: ['#cde2fb', '#9ec5f4', '#5598e7', '#256abf'],
    status: { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' },
    grid: '#2d394f',
    axis: '#718096',
    surface: '#161e2e',
  },
};

export function useChartPalette(): ChartPalette {
  const theme = useThemeStore((s) => s.theme);
  return PALETTES[theme];
}

/** Shared axis styling: hairline, recessive, solid. Never dashed. */
export function axisProps(palette: ChartPalette) {
  return {
    stroke: palette.axis,
    tick: { fill: palette.axis, fontSize: 11 },
    tickLine: false,
    axisLine: false,
  };
}

/**
 * One chart in its own card. The height passed in is the plot area only - the
 * card grows to fit the heading and the axis band, so an axis label can never
 * be cropped into a nested scrollbar.
 */
export function ChartCard({
  title,
  description,
  legend,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  legend?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('card card-pad', className)}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold tracking-tight text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">{description}</p>}
        </div>
        {action}
      </header>
      {legend && <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">{legend}</div>}
      {children}
    </section>
  );
}

/**
 * Legend swatch. The label is always text in an ink token - the colour beside
 * it carries identity, it never carries the meaning on its own.
 */
export function LegendKey({ color, label, value }: { color: string; label: string; value?: number | string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-soft">
      <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} aria-hidden />
      {label}
      {value !== undefined && <span className="font-bold tabular-nums text-ink">{value}</span>}
    </span>
  );
}

/** Tooltip shared by every chart on the page, so hovering feels the same everywhere. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean;
  payload?: any[];
  label?: any;
  labelFormatter?: (value: any) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="pointer-events-none rounded-xl border border-slate-200 bg-surface px-3 py-2 shadow-pop">
      <p className="mb-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-ink-faint">
        {labelFormatter ? labelFormatter(label) : label}
      </p>
      <div className="space-y-1">
        {payload.map((item: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-[13px]">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: item.color || item.fill }}
              aria-hidden
            />
            <span className="text-ink-muted">{item.name}</span>
            <span className="ml-auto font-bold tabular-nums text-ink">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shown in place of a plot when the window genuinely holds no data. */
export function NoData({ message, height = 200 }: { message: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 text-[13px] text-ink-muted"
      style={{ height }}
    >
      {message}
    </div>
  );
}
