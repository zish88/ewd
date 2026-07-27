import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export type ModernSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type ModernSelectGroup = {
  id: string;
  label: string;
  options: ModernSelectOption[];
};

type ModernSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options?: ModernSelectOption[];
  groups?: ModernSelectGroup[];
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
  ariaLabel: string;
};

type PopupPosition = {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
};

const EDGE = 8;
const GAP = 6;

export function ModernSelect({
  value,
  onChange,
  options = [],
  groups = [],
  placeholder = "—",
  disabled = false,
  testId,
  ariaLabel,
}: ModernSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<PopupPosition | null>(null);

  const flatOptions = useMemo(
    () => [...options, ...groups.flatMap((group) => group.options)],
    [groups, options],
  );
  const selectedIndex = flatOptions.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? flatOptions[selectedIndex] : null;

  const firstEnabled = () => {
    const index = flatOptions.findIndex((option) => !option.disabled);
    return index >= 0 ? index : 0;
  };

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(Math.max(rect.width, 220), viewportWidth - EDGE * 2);
    const left = Math.min(
      Math.max(rect.left, EDGE),
      Math.max(EDGE, viewportWidth - width - EDGE),
    );
    const below = viewportHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;
    const opensUp = below < 220 && above > below;
    const maxHeight = Math.max(120, Math.min(420, opensUp ? above : below));

    setPosition(
      opensUp
        ? { left, bottom: viewportHeight - rect.top + GAP, width, maxHeight }
        : { left, top: rect.bottom + GAP, width, maxHeight },
    );
  };

  const openList = () => {
    if (disabled || flatOptions.length === 0) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled());
    setOpen(true);
  };

  const closeList = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const choose = (option: ModernSelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    closeList(true);
  };

  const moveActive = (direction: 1 | -1) => {
    if (!flatOptions.length) return;
    let next = activeIndex;
    for (let step = 0; step < flatOptions.length; step += 1) {
      next = (next + direction + flatOptions.length) % flatOptions.length;
      if (!flatOptions[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openList();
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) openList();
      else if (flatOptions[activeIndex]) choose(flatOptions[activeIndex]);
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(firstEnabled());
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      for (let index = flatOptions.length - 1; index >= 0; index -= 1) {
        if (!flatOptions[index]?.disabled) {
          setActiveIndex(index);
          break;
        }
      }
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeList();
      return;
    }
    if (event.key === "Tab" && open) {
      closeList();
    }
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onViewportChange = () => updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) {
        closeList();
      }
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  let optionIndex = 0;
  const renderOption = (option: ModernSelectOption) => {
    const index = optionIndex++;
    const isSelected = option.value === value;
    const isActive = index === activeIndex;
    return (
      <button
        key={`${option.value}-${index}`}
        type="button"
        role="option"
        aria-selected={isSelected}
        tabIndex={-1}
        disabled={option.disabled}
        data-option-index={index}
        className={[
          "modern-select__option",
          isSelected ? "is-selected" : "",
          isActive ? "is-active" : "",
        ].filter(Boolean).join(" ")}
        onPointerMove={() => {
          if (!option.disabled) setActiveIndex(index);
        }}
        onClick={() => choose(option)}
      >
        <span>{option.label}</span>
        {isSelected ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m5 12 4 4L19 6" />
          </svg>
        ) : null}
      </button>
    );
  };

  const popupStyle = position
    ? ({
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        width: position.width,
        maxHeight: position.maxHeight,
      } satisfies CSSProperties)
    : undefined;

  return (
    <div ref={rootRef} className="modern-select">
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        className="app-input modern-select__trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={selected ? "" : "modern-select__placeholder"}>
          {selected?.label || placeholder}
        </span>
        <svg className="modern-select__chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 10 5 5 5-5" />
        </svg>
      </button>

      {open && position
        ? createPortal(
            <div
              ref={listRef}
              className="modern-select__popup"
              style={popupStyle}
              role="listbox"
              aria-label={ariaLabel}
            >
              {options.map(renderOption)}
              {groups.map((group) =>
                group.options.length ? (
                  <div className="modern-select__group" key={group.id} role="group" aria-label={group.label}>
                    <div className="modern-select__group-label">{group.label}</div>
                    {group.options.map(renderOption)}
                  </div>
                ) : null,
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

