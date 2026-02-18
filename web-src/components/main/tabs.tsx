import React, { useId, useMemo, useState } from "react";
import { useSwipeable } from "react-swipeable";
import { SectionPanel } from "../ui";

type TabItem = {
  key: string;
  label: React.ReactNode;
  content: React.ReactNode;
  disabled?: boolean;
};

type NiceTabsProps = {
  tabs: TabItem[];
  initialKey?: string;
  className?: string;
  onTabChange?: (key: string) => void;
};

export function NiceTabs({
  tabs,
  initialKey,
  className,
  onTabChange,
}: NiceTabsProps) {
  const uid = useId();
  const firstEnabledKey = useMemo(
    () => tabs.find((t) => !t.disabled)?.key ?? tabs[0]?.key ?? "",
    [tabs],
  );

  const [activeKey, setActiveKey] = useState<string>(initialKey ?? firstEnabledKey);

  const setActiveTab = (key: string) => {
    setActiveKey(key);
    onTabChange?.(key);
  };

  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.key === activeKey),
  );

  const activeTab = tabs[activeIndex] ?? tabs[0];

  function moveFocus(currentIndex: number, delta: number) {
    if (tabs.length === 0) return;
    let i = currentIndex;

    for (let tries = 0; tries < tabs.length; tries++) {
      i = (i + delta + tabs.length) % tabs.length;
      if (!tabs[i].disabled) {
        setActiveTab(tabs[i].key);
        return;
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      moveFocus(activeIndex, +1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveFocus(activeIndex, -1);
    } else if (e.key === "Home") {
      e.preventDefault();
      const idx = tabs.findIndex((t) => !t.disabled);
      if (idx >= 0) setActiveTab(tabs[idx].key);
    } else if (e.key === "End") {
      e.preventDefault();
      for (let idx = tabs.length - 1; idx >= 0; idx--) {
        if (!tabs[idx].disabled) {
          setActiveTab(tabs[idx].key);
          break;
        }
      }
    }
  }
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => moveFocus(activeIndex, +1),
    onSwipedRight: () => moveFocus(activeIndex, -1),
    delta: 56,
    preventScrollOnSwipe: false,
    trackTouch: true,
    trackMouse: false,
  });

  return (
    <div className={className}>
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Sections"
        onKeyDown={onKeyDown}
        className="scrollbar-glass mb-2 flex w-full flex-wrap gap-2 overflow-x-auto rounded-xl bg-white/5 p-1 ring-1 ring-white/10 sm:flex-nowrap"
      >
        {tabs.map((t, idx) => {
          const selected = t.key === activeKey;
          const tabId = `${uid}-tab-${t.key}`;
          const panelId = `${uid}-panel-${t.key}`;

          return (
            <button
              key={t.key}
              id={tabId}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              disabled={t.disabled}
              onClick={() => !t.disabled && setActiveTab(t.key)}
              className={[
                "cursor-pointer",
                "relative min-w-[calc(50%-0.25rem)] flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition sm:min-w-0",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                t.disabled
                  ? "cursor-not-allowed text-white/30"
                  : "text-white/70 hover:text-white/90",
                selected
                  ? "bg-[#3a256a] text-white shadow-sm ring-1 ring-white/10"
                  : "bg-transparent",
              ].join(" ")}
            >
              <span className="inline-flex items-center justify-center gap-2">{t.label}</span>
              {selected && (
                <span className="pointer-events-none absolute inset-0 rounded-lg shadow-[0_0_20px_rgba(170,130,255,0.18)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Panel */}
      {activeTab && (
        <SectionPanel
          id={`${uid}-panel-${activeTab.key}`}
          role="tabpanel"
          aria-labelledby={`${uid}-tab-${activeTab.key}`}
          {...swipeHandlers}
          className="lg:min-h-0 lg:flex-1 lg:overflow-hidden"
        >
          {activeTab.content}
        </SectionPanel>
      )}
    </div>
  );
}
