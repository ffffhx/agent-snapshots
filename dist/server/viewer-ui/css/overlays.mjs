// @ts-nocheck
export const overlaysCss = `/* ---------- 搜索浮层 ---------- */
.search-overlay {
  position: fixed; inset: 0; z-index: 40;
  display: grid; justify-items: start; align-items: start;
  background: rgba(38, 28, 12, 0.16);
  padding: clamp(14px, 4dvh, 44px) 16px;
  backdrop-filter: blur(2px) saturate(0.96);
}
.search-overlay[hidden] { display: none; }
.search-dialog {
  display: flex; flex-direction: column; gap: 12px; width: min(560px, 94vw);
  max-height: calc(100dvh - 2 * clamp(14px, 4dvh, 44px));
  border: 1px solid var(--line-2); border-top: 3px solid var(--seal);
  border-radius: 12px; background: linear-gradient(180deg, var(--panel), var(--panel-2));
  padding: 18px; box-shadow: 0 42px 100px -44px rgba(38, 24, 8, 0.85);
  animation: turn-rise 0.28s cubic-bezier(0.2, 0.7, 0.3, 1) both;
}
.search-results { flex: 1 1 auto; }
.search-flag {
  min-height: 32px; border: 1px solid var(--line-2); border-radius: 8px;
  background: transparent; color: var(--muted);
  padding: 0 10px; font: 700 11px/1 var(--mono); letter-spacing: 0.02em;
}
.search-flag:hover { border-color: var(--line-2); background: rgba(127, 110, 80, 0.1); color: var(--ink); transform: none; }
.search-flag[aria-pressed="true"] { border-color: var(--seal); background: var(--seal-soft); color: var(--seal-deep); }
.search-facets { display: flex; flex-wrap: wrap; gap: 6px; }
.search-facets:empty { display: none; }
.facet-chip {
  display: inline-flex; align-items: center; gap: 5px;
  min-height: 26px; border: 1px solid var(--line-2); border-radius: 999px;
  background: transparent; color: var(--ink-soft);
  padding: 0 10px; font: 600 10.5px/1 var(--mono); letter-spacing: 0.02em;
  cursor: pointer;
}
.facet-chip:hover { border-color: var(--seal); color: var(--seal-deep); background: transparent; transform: none; }
.facet-chip.active { border-color: var(--seal); background: var(--seal-soft); color: var(--seal-deep); }
.facet-chip b { color: var(--faint); font-weight: 700; }
.facet-chip.active b { color: var(--seal-deep); }
.search-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 2px; }
.search-hints { min-width: 0; overflow: hidden; color: var(--faint); font: 600 11px/1.5 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.search-hints kbd { display: inline-block; min-width: 15px; margin: 0 1px; border: 1px solid var(--line-2); border-radius: 5px; background: rgba(127, 110, 80, 0.1); color: var(--muted); padding: 1px 5px; font: 700 10px/1.4 var(--mono); }
.search-count { flex: 0 0 auto; color: var(--muted); font: 700 11px/1.4 var(--mono); }
.search-result-actions { grid-column: 1 / -1; display: none; gap: 6px; margin-top: 4px; }
.search-result.active .search-result-actions { display: flex; flex-wrap: wrap; }
.sr-act {
  min-height: 26px; border: 1px solid var(--line-2); border-radius: 7px;
  background: transparent; color: var(--ink-soft);
  padding: 0 9px; font: 600 10.5px/1 var(--mono); letter-spacing: 0.02em;
}
.sr-act:hover { border-color: var(--seal); background: transparent; color: var(--seal-deep); transform: none; }
.stats-overlay {
  position: fixed; inset: 0; z-index: 45;
  display: grid; place-items: start center;
  background: rgba(38, 28, 12, 0.36);
  padding: clamp(18px, 7dvh, 64px) 18px 18px;
  backdrop-filter: blur(6px) saturate(0.9);
}
.stats-overlay[hidden] { display: none; }
.stats-dialog {
  display: flex; flex-direction: column; gap: 16px; width: min(1060px, 96vw);
  max-height: calc(100dvh - 40px); overflow: auto;
  border: 1px solid var(--line-2); border-top: 3px solid var(--seal);
  border-radius: 12px; background: linear-gradient(180deg, var(--panel), var(--panel-2));
  padding: 20px; box-shadow: 0 42px 100px -44px rgba(38, 24, 8, 0.85);
  animation: turn-rise 0.28s cubic-bezier(0.2, 0.7, 0.3, 1) both;
}
.stats-bar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.stats-bar h2 { font-size: 22px; font-weight: 600; }
.stats-bar-actions { display: inline-flex; gap: 8px; }
.stats-refresh { min-height: 34px; border-color: var(--line-2); background: transparent; color: var(--muted); }
.stats-refresh:hover { border-color: var(--seal); background: transparent; color: var(--seal); }
.stats-body { display: flex; flex-direction: column; gap: 16px; }
.stats-shell { display: flex; flex-direction: column; gap: 14px; }
.stats-filterbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-top: 2px; }
.stats-chip-group { display: inline-flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.stats-chip {
  min-height: 30px; border: 1px solid var(--line-2); border-radius: 999px;
  background: transparent; color: var(--ink-soft);
  padding: 0 11px; font: 700 11px/1 var(--mono);
}
.stats-chip:hover { border-color: var(--seal); color: var(--seal-deep); background: transparent; transform: none; }
.stats-chip.active { border-color: var(--seal); background: var(--seal-soft); color: var(--seal-deep); }
.stats-chip b { color: var(--faint); font-weight: 700; }
.stats-chip.active b { color: var(--seal-deep); }
.stats-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px 18px; }
.stats-section { min-width: 0; border-top: 1px solid var(--line); padding-top: 12px; }
.stats-section-quota, .stats-section-usage { grid-column: span 5; }
.stats-section-activity, .stats-section-projects { grid-column: span 7; }
.stats-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.stats-section h3 { margin: 0; color: var(--ink-soft); font: 700 13px/1.2 var(--sans); }
.stats-section-meta { color: var(--faint); font: 700 10.5px/1.2 var(--mono); white-space: nowrap; }
.stats-section-actions { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.stats-mini-action {
  min-height: 28px; border: 1px solid var(--line-2); border-radius: 7px;
  background: transparent; color: var(--muted);
  padding: 0 10px; font: 800 10.5px/1 var(--mono); white-space: nowrap;
}
.stats-mini-action:hover { border-color: var(--seal); background: transparent; color: var(--seal-deep); transform: none; }
.stats-mini-action[aria-pressed="true"] { border-color: var(--seal); background: var(--seal-soft); color: var(--seal-deep); }
.stats-subsection { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
.stats-subsection .stats-section-head { margin-bottom: 8px; }
.stats-skeleton { display: grid; gap: 8px; }
.stats-skeleton-line {
  height: 12px; border-radius: 999px;
  background: linear-gradient(90deg, rgba(127,110,80,0.08), rgba(127,110,80,0.16), rgba(127,110,80,0.08));
  background-size: 220% 100%;
}
.stats-skeleton-line.short { width: 42%; }
.stats-skeleton-line.mid { width: 70%; }
@keyframes skeleton-shift { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.stat-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.stat-tile { display: flex; flex-direction: column; gap: 3px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel-wash); padding: 12px 14px; }
.stat-tile-k { color: var(--faint); font: 700 10.5px/1.2 var(--mono); letter-spacing: 0.05em; text-transform: uppercase; }
.stat-tile-v { color: var(--ink); font: 700 24px/1.1 var(--serif); }
.stat-tile-sub { color: var(--muted); font: 600 11px/1.3 var(--mono); }
.stat-rows { display: flex; flex-direction: column; gap: 6px; }
.stat-row { display: grid; grid-template-columns: minmax(80px, 150px) 1fr auto; gap: 10px; align-items: center; }
.stat-row-name { overflow: hidden; color: var(--ink-soft); font: 600 12px/1.3 var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.stat-row-track { height: 8px; border-radius: 999px; background: rgba(127, 110, 80, 0.14); overflow: hidden; }
.stat-row-fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--seal), var(--amber)); }
.stat-row-val { color: var(--ink); font: 700 11.5px/1.2 var(--mono); white-space: nowrap; }
.stat-row-val b { color: var(--faint); font-weight: 600; }
.stats-muted { color: var(--faint); font: 600 12px/1.4 var(--mono); }
.quota-list { display: grid; gap: 12px; }
.quota-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 5px; }
.quota-label { color: var(--ink-soft); font: 700 12px/1.2 var(--sans); }
.quota-value { color: var(--ink); font: 800 12px/1 var(--mono); }
.quota-track { height: 12px; border-radius: 999px; background: rgba(127, 110, 80, 0.14); overflow: hidden; box-shadow: inset 0 0 0 1px rgba(33, 27, 16, 0.05); }
.quota-fill { display: block; height: 100%; min-width: 2px; border-radius: inherit; transition: width 0.25s ease; }
.quota-meta { display: flex; justify-content: space-between; gap: 10px; margin-top: 5px; color: var(--faint); font: 650 10.5px/1.3 var(--mono); }
.quota-block-card { border: 1px solid var(--line); border-radius: 8px; background: var(--panel-wash); padding: 12px; }
.quota-stat-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.quota-stat { min-width: 0; border-radius: 6px; background: rgba(255,255,255,0.36); box-shadow: inset 0 0 0 1px rgba(33,27,16,0.05); padding: 8px 9px; }
.quota-stat b, .quota-stat small, .quota-stat em { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quota-stat b { color: var(--ink); font: 800 16px/1.1 var(--mono); }
.quota-stat small { margin-top: 4px; color: var(--ink-soft); font: 700 10.5px/1.2 var(--sans); }
.quota-stat em { margin-top: 3px; color: var(--faint); font: 650 10px/1.2 var(--mono); font-style: normal; }
.activity-panel { display: grid; gap: 14px; }
.heatmap-frame { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px; align-items: start; overflow-x: auto; padding-bottom: 2px; }
.heatmap-weekdays { display: grid; grid-template-rows: repeat(7, 10px); gap: 3px; color: var(--faint); font: 700 9px/10px var(--mono); }
.activity-heatmap { display: grid; grid-auto-flow: column; grid-auto-columns: 10px; grid-template-rows: repeat(7, 10px); gap: 3px; min-width: max-content; }
.activity-day { width: 10px; height: 10px; border: 1px solid rgba(33, 27, 16, 0.06); border-radius: 2px; background: rgba(127, 110, 80, 0.10); }
.activity-day.level-1 { background: rgba(47, 93, 73, 0.28); }
.activity-day.level-2 { background: rgba(47, 93, 73, 0.48); }
.activity-day.level-3 { background: rgba(154, 106, 27, 0.62); }
.activity-day.level-4 { background: rgba(177, 56, 42, 0.76); }
.hour-panel { display: grid; gap: 5px; }
.hour-bars { height: 54px; display: grid; grid-template-columns: repeat(24, minmax(4px, 1fr)); align-items: end; gap: 3px; }
.hour-bar { min-height: 2px; border-radius: 3px 3px 0 0; background: linear-gradient(180deg, var(--seal), var(--amber)); opacity: 0.88; }
.hour-axis { display: grid; grid-template-columns: repeat(4, 1fr); color: var(--faint); font: 700 9.5px/1 var(--mono); }
.hour-axis span:nth-child(2), .hour-axis span:nth-child(3) { text-align: center; }
.hour-axis span:last-child { text-align: right; }
.weekly-digest-panel { display: grid; gap: 12px; }
.weekly-digest-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.weekly-digest-toolbar b { display: block; color: var(--ink); font: 750 14px/1.2 var(--sans); }
.weekly-digest-toolbar span { display: block; margin-top: 3px; color: var(--faint); font: 700 10.5px/1.25 var(--mono); }
.weekly-digest-actions { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.weekly-digest-warning {
  border: 1px solid rgba(177,56,42,0.28); border-radius: 8px;
  background: rgba(177,56,42,0.06); color: var(--seal);
  padding: 8px 10px; font: 650 11px/1.35 var(--mono);
}
.weekly-digest-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.weekly-card {
  min-width: 0; border: 1px solid var(--line); border-radius: 8px;
  background: var(--panel-wash); padding: 12px;
}
.weekly-card.primary { border-color: rgba(47, 93, 73, 0.32); background: rgba(47, 93, 73, 0.055); }
.weekly-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.weekly-card-head strong { color: var(--ink); font: 750 13px/1.2 var(--sans); }
.weekly-card-head span { overflow: hidden; color: var(--faint); font: 700 10px/1.2 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.weekly-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
.weekly-metric {
  min-width: 0; border-radius: 7px; background: rgba(255,255,255,0.34);
  box-shadow: inset 0 0 0 1px rgba(33,27,16,0.05); padding: 9px 10px;
}
.weekly-metric span, .weekly-metric strong, .weekly-metric em { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weekly-metric span { color: var(--faint); font: 800 10px/1.1 var(--mono); }
.weekly-metric strong { margin-top: 5px; color: var(--ink); font: 800 19px/1.1 var(--mono); }
.weekly-delta { margin-top: 5px; font: 800 10.5px/1.1 var(--mono); font-style: normal; }
.weekly-delta.up { color: var(--pine); }
.weekly-delta.down { color: var(--seal); }
.weekly-delta.flat { color: var(--faint); }
.weekly-detail-list { display: grid; gap: 6px; }
.weekly-detail-list span {
  min-width: 0; overflow: hidden; color: var(--ink-soft); font: 600 11.5px/1.35 var(--sans);
  text-overflow: ellipsis; white-space: nowrap;
}
.weekly-detail-list b { margin-right: 6px; color: var(--faint); font: 800 10px/1 var(--mono); }
.weekly-projects { display: grid; gap: 8px; }
.weekly-project-table { width: 100%; border-collapse: collapse; table-layout: fixed; color: var(--ink-soft); font: 650 11.5px/1.3 var(--sans); }
.weekly-project-table th, .weekly-project-table td { border-bottom: 1px solid var(--line); padding: 6px 4px; text-align: right; }
.weekly-project-table th:first-child, .weekly-project-table td:first-child { width: 58%; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.weekly-project-table th { color: var(--faint); font: 800 10px/1.2 var(--mono); }
.project-ranks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.rank-title { margin: 0 0 8px; color: var(--muted); font: 800 10.5px/1 var(--mono); letter-spacing: 0.04em; }
.rank-list { display: grid; gap: 7px; }
.rank-row { display: grid; grid-template-columns: minmax(86px, 1fr) minmax(72px, 0.8fr) auto; gap: 8px; align-items: center; }
.rank-name { overflow: hidden; color: var(--ink-soft); font: 650 12px/1.25 var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.rank-track { height: 7px; border-radius: 999px; background: rgba(127, 110, 80, 0.14); overflow: hidden; }
.rank-fill { display: block; height: 100%; min-width: 2px; border-radius: inherit; background: linear-gradient(90deg, var(--pine), var(--amber)); }
.rank-val { color: var(--ink); font: 800 10.5px/1.2 var(--mono); white-space: nowrap; text-align: right; }
.rank-val b { display: block; color: var(--faint); font: 650 9.5px/1.2 var(--mono); }
.stats-cost-inputs { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
.stats-cost-inputs label { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font: 600 12px/1 var(--mono); }
.stats-cost-inputs input { width: 82px; height: 32px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--field-bg); color: var(--ink); padding: 0 8px; font: 600 12px/1 var(--mono); }
.stats-cost-out { color: var(--ink-soft); font: 600 14px/1.4 var(--sans); }
.stats-cost-out b { color: var(--seal-deep); font-weight: 700; font-size: 18px; }
.stats-cost-out span { color: var(--faint); font: 500 11px/1.3 var(--mono); }
.stats-note { margin: 0; color: var(--faint); font: 500 11px/1.5 var(--mono); }
.gallery-overlay {
  position: fixed; inset: 0; z-index: 50;
  display: grid; place-items: center;
  background: rgba(38, 28, 12, 0.38);
  padding: clamp(10px, 2.4dvh, 22px);
  backdrop-filter: blur(7px) saturate(0.9);
  animation: overlay-fade 0.2s ease both;
}
.gallery-overlay[hidden] { display: none; }
.gallery-dialog {
  display: flex; flex-direction: column; gap: 14px;
  width: min(1320px, 100%);
  height: min(980px, calc(100dvh - 2 * clamp(10px, 2.4dvh, 22px)));
  min-height: 0;
  border: 1px solid var(--line-2);
  border-top: 3px solid var(--seal);
  border-radius: 12px;
  background: linear-gradient(180deg, var(--panel), var(--panel-2));
  padding: 18px;
  box-shadow: 0 42px 110px -44px rgba(20, 12, 4, 0.9);
  animation: turn-rise 0.26s var(--ease-rise) both;
}
.gallery-bar {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 12px;
}
.gallery-bar h2 { font-size: 24px; font-weight: 600; }
.gallery-filters { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
.gallery-chip {
  min-height: 30px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-soft);
  padding: 0 12px;
  font: 700 11px/1 var(--mono);
}
.gallery-chip:hover { border-color: var(--seal); color: var(--seal-deep); background: transparent; transform: none; }
.gallery-chip.active { border-color: var(--seal); background: var(--seal-soft); color: var(--seal-deep); }
.gallery-body { min-height: 0; overflow: auto; padding-right: 4px; scrollbar-width: thin; }
.gallery-grid { columns: 220px; column-gap: 14px; }
.gallery-card {
  display: inline-block;
  width: 100%;
  margin: 0 0 14px;
  break-inside: avoid;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-wash);
  overflow: hidden;
  box-shadow: 0 18px 38px -34px rgba(64, 44, 14, 0.72);
}
.gallery-card:hover { border-color: rgba(177, 56, 42, 0.4); box-shadow: 0 22px 46px -36px rgba(140, 43, 31, 0.62); }
.gallery-thumb {
  display: block;
  width: 100%;
  max-height: 360px;
  border: 0;
  border-radius: 0;
  background: var(--wash-1);
  padding: 0;
  cursor: zoom-in;
  overflow: hidden;
}
.gallery-thumb:hover { background: var(--wash-2); transform: none; }
.gallery-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: var(--panel);
  opacity: 0;
  transition: opacity 180ms ease;
}
.gallery-thumb img.loaded { opacity: 1; }
.gallery-card-meta {
  display: grid;
  gap: 4px;
  width: 100%;
  min-height: 58px;
  border: 0;
  border-top: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  padding: 10px 11px;
  text-align: left;
}
.gallery-card-meta:hover { background: var(--wash-2); transform: none; }
.gallery-card-meta strong {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font: 650 13px/1.28 var(--sans);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gallery-card-meta span {
  min-width: 0;
  overflow: hidden;
  color: var(--faint);
  font: 650 10.5px/1.35 var(--mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gallery-footer {
  display: flex;
  justify-content: center;
  padding: 16px 0 4px;
}
.gallery-more {
  min-height: 36px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: transparent;
  color: var(--ink-soft);
  padding: 0 14px;
  font: 700 11px/1 var(--mono);
}
.gallery-more:hover { border-color: var(--seal); background: transparent; color: var(--seal-deep); transform: none; }
.gallery-empty {
  display: grid;
  min-height: 240px;
  place-items: center;
  border: 1px dashed var(--line-2);
  border-radius: 10px;
  color: var(--faint);
  font: 700 13px/1.5 var(--mono);
}
.gallery-error { border-color: rgba(177,56,42,0.45); color: var(--seal); }
.gallery-lightbox {
  position: fixed; inset: 0; z-index: 70;
  display: grid;
  grid-template-columns: minmax(44px, 8vw) minmax(0, 1fr) minmax(44px, 8vw);
  place-items: center;
  gap: 12px;
  background: rgba(10, 8, 6, 0.86);
  padding: 24px;
  animation: overlay-fade 0.16s ease both;
}
.gallery-lightbox[hidden] { display: none; }
.gallery-lightbox-figure {
  display: grid;
  gap: 12px;
  justify-items: center;
  max-width: 100%;
  max-height: 100%;
  margin: 0;
}
.gallery-lightbox img {
  display: block;
  max-width: min(1120px, 100%);
  max-height: calc(100dvh - 112px);
  border: 1px solid rgba(255, 245, 222, 0.22);
  border-radius: 8px;
  background: #111;
  object-fit: contain;
  box-shadow: 0 28px 80px -30px rgba(0, 0, 0, 0.9);
}
.gallery-lightbox figcaption {
  max-width: min(760px, 88vw);
  overflow: hidden;
  color: rgba(255, 245, 222, 0.82);
  font: 650 12px/1.45 var(--mono);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gallery-lightbox-nav {
  display: grid;
  width: 42px;
  height: 56px;
  place-items: center;
  border: 1px solid rgba(255, 245, 222, 0.22);
  border-radius: 8px;
  background: rgba(255, 245, 222, 0.06);
  color: rgba(255, 245, 222, 0.82);
  font: 400 34px/1 var(--serif);
}
.gallery-lightbox-nav:hover { border-color: rgba(255, 245, 222, 0.5); background: rgba(255, 245, 222, 0.12); color: #fff; transform: none; }
@media (max-width: 900px) {
  .stats-filterbar { align-items: flex-start; flex-direction: column; }
  .stats-chip-group { justify-content: flex-start; }
  .stats-section-quota, .stats-section-usage, .stats-section-activity, .stats-section-projects { grid-column: 1 / -1; }
  .weekly-digest-toolbar { align-items: stretch; flex-direction: column; }
  .weekly-digest-actions { justify-content: flex-start; }
  .weekly-digest-grid { grid-template-columns: 1fr; }
  .project-ranks { grid-template-columns: 1fr; }
  .gallery-dialog { height: calc(100dvh - 20px); padding: 14px; }
  .gallery-grid { columns: 150px; column-gap: 10px; }
  .gallery-card { margin-bottom: 10px; }
  .gallery-lightbox { grid-template-columns: 1fr; grid-template-rows: 1fr auto; padding: 16px; }
  .gallery-lightbox-nav { position: fixed; top: 50%; transform: translateY(-50%); }
  .gallery-lightbox-nav.prev { left: 12px; }
  .gallery-lightbox-nav.next { right: 12px; }
}
.exports .resume-orca { border-color: var(--pine); background: var(--pine); color: #eef5ef; }
.exports .resume-orca:hover { border-color: var(--pine); background: #26483a; color: #fff; }
.sr-act-orca { border-color: var(--pine); color: var(--pine); }
.sr-act-orca:hover { border-color: var(--pine); background: var(--pine); color: #fff; }
.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 60;
  max-width: min(560px, 92vw);
  border: 1px solid var(--line-2); border-left: 3px solid var(--pine);
  border-radius: 10px; background: var(--panel); color: var(--ink);
  padding: 12px 16px; font: 600 13px/1.4 var(--sans);
  box-shadow: var(--shadow-panel);
  animation: turn-rise 0.2s ease both;
}
.toast[hidden] { display: none; }
.toast.error { border-left-color: var(--seal); }
.search-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; }
.search-bar h2 { font-size: 22px; font-weight: 600; }
.search-close { min-height: 34px; border-color: var(--line-2); background: transparent; color: var(--muted); }
.search-close:hover { border-color: var(--seal); background: transparent; color: var(--seal); }
.global-search-input { width: 100%; height: 46px; font-size: 15px; }
.search-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.search-mode, .search-prewarm { min-height: 32px; border-color: var(--line-2); background: transparent; color: var(--muted); padding: 0 11px; }
.search-mode:hover, .search-prewarm:hover { border-color: var(--line-2); background: rgba(33, 27, 16, 0.06); color: var(--ink); transform: none; }
.search-mode.active { border-color: var(--ink); background: var(--ink); color: var(--paper); }
.search-mode:disabled, .search-prewarm:disabled { border-color: var(--line); background: rgba(33, 27, 16, 0.04); color: var(--faint); }
.search-prewarm[aria-busy="true"] { border-color: rgba(47, 93, 73, 0.45); background: rgba(47, 93, 73, 0.08); color: var(--pine); }
.search-scope-label {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  max-width: min(320px, 100%);
  border: 1px solid var(--line);
  border-radius: 9px;
  background: rgba(33, 27, 16, 0.035);
  color: var(--muted);
  padding: 0 11px;
  font: 700 11px/1 var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-status { min-width: 0; color: var(--faint); font: 600 11.5px/1.35 var(--mono); }
.search-results { display: grid; grid-auto-rows: max-content; gap: 8px; align-content: start; min-height: 0; overflow: auto; padding-right: 4px; }
.search-empty {
  display: grid; min-height: 112px; place-items: center;
  border: 1px dashed var(--line-2); border-radius: 10px;
  color: var(--faint); font: 600 13px/1.45 var(--mono);
}
.search-result {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 14px; min-height: 0;
  border: 1px solid var(--line); border-radius: 10px;
  background: var(--panel-wash); color: var(--ink);
  padding: 12px; text-align: left; font-family: var(--sans);
  cursor: pointer;
  transition: background 130ms ease, border-color 130ms ease, box-shadow 130ms ease;
}
.search-result:hover, .search-result.active { border-color: rgba(177, 56, 42, 0.5); background: var(--result-active-bg); transform: none; box-shadow: 0 14px 30px -26px rgba(140, 43, 31, 0.6); }
.search-result strong, .search-result span, .search-result p { min-width: 0; }
.search-result-title { overflow: hidden; font: 600 15px/1.3 var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.search-result-source { color: var(--faint); font: 700 10.5px/1 var(--mono); letter-spacing: 0.05em; white-space: nowrap; }
.search-result-path { grid-column: 1 / -1; overflow: hidden; color: var(--faint); font: 500 11px/1.35 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.search-result-snippet {
  display: -webkit-box;
  grid-column: 1 / -1;
  margin: 0;
  overflow: hidden;
  color: var(--ink-soft);
  font: 400 13.5px/1.55 var(--sans);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.search-result-snippet mark { border-radius: 2px; background: linear-gradient(180deg, rgba(234, 197, 110, 0.2), rgba(234, 197, 110, 0.72)); color: inherit; padding: 0 2px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.search-result-meta { grid-column: 1 / -1; color: var(--faint); font: 600 10.5px/1.3 var(--mono); letter-spacing: 0.05em; text-transform: uppercase; }

.project-group.no-project .project-headline { grid-template-columns: minmax(0, 1fr); }
.project-group.no-project .project-header { grid-template-columns: minmax(0, 1fr) auto; }
.project-group.no-project .project-icon { display: none; }

@media (max-width: 900px) {
  .app { grid-template-columns: 1fr; grid-template-rows: minmax(220px, 38dvh) minmax(0, 1fr); }
  .splitter { display: none; }
  .sidebar { border-right: 0; border-bottom: 2px solid var(--ink); }
  .mh-row { flex-wrap: wrap; }
  .mh-row h2 { flex-basis: 100%; }
  .settings-popover { position: fixed; top: 92px; right: 12px; left: 12px; width: auto; max-height: calc(100dvh - 112px); }
  .settings-section { grid-template-columns: 1fr; gap: 7px; }
  .settings-seg, .settings-control-row { width: 100%; }
  .settings-seg .appx { flex: 1 1 0; }
  .turns { gap: 32px; }
  .user .message-card, .assistant .message-card, .tool .message-card { max-width: 100%; }
  .body { font-size: 17px; }
}
@media (prefers-reduced-motion: reduce) {
  .loading-spinner, .session-live-dot, .live-indicator .live-dot { animation: none; }
  .turn, .search-dialog { animation: none; }
  * { transition-duration: 0.01ms !important; }
}


`;
