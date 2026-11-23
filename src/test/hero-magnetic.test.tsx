// Homepage hero tiles: the magnetic "joystick" response to a mouse cursor (pushed away, capped, springs back), and no
// response for touch input or prefers-reduced-motion. The floating CSS animation class is never removed.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroBackground } from "@/components/site/HeroBackground";

let fine = true;
let reduced = false;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  window.matchMedia = ((q: string) => ({
    matches: q.includes("reduced-motion") ? reduced : q.includes("pointer: fine") ? fine : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  // jsdom has no layout: give every tile a 56px box at (100, 100) and a visible offsetParent.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    width: 56,
    height: 56,
    right: 156,
    bottom: 156,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  fine = true;
  reduced = false;
});

const move = (x: number, y: number, pointerType = "mouse") =>
  act(() => {
    // jsdom has no PointerEvent: a MouseEvent named "pointermove" with a pointerType stands in for it.
    const e = new MouseEvent("pointermove", { clientX: x, clientY: y });
    Object.defineProperty(e, "pointerType", { value: pointerType });
    window.dispatchEvent(e);
    vi.advanceTimersByTime(2000);
  });
const offset = (el: HTMLElement) => {
  const [x = 0, y = 0] = (el.style.translate || "0px 0px").split(" ").map(parseFloat);
  return { x, y, m: Math.hypot(x, y) };
};

describe("hero floating tiles", () => {
  it("move away from a nearby mouse cursor, at most 12px, and return when it leaves", () => {
    const tile = render(<HeroBackground />).container.querySelector<HTMLElement>(".float-tile")!;
    move(128 + 40, 128); // 40px to the right of the tile's centre
    const o = offset(tile);
    expect(o.x).toBeLessThan(-4); // pushed left
    expect(Math.abs(o.y)).toBeLessThan(0.5);
    expect(o.m).toBeLessThanOrEqual(12);
    move(128, 128 - 1); // almost on the centre: still capped
    expect(offset(tile).m).toBeLessThanOrEqual(12);
    move(900, 900); // far away
    expect(tile.style.translate || "").toBe("");
    expect(tile.classList.contains("float-tile")).toBe(true);
  });

  it("ignores touch input", () => {
    const tile = render(<HeroBackground />).container.querySelector<HTMLElement>(".float-tile")!;
    move(150, 128, "touch");
    expect(tile.style.translate || "").toBe("");
  });

  it("is off on touch-only devices and with prefers-reduced-motion", () => {
    fine = false;
    let tile = render(<HeroBackground />).container.querySelector<HTMLElement>(".float-tile")!;
    move(150, 128);
    expect(tile.style.translate || "").toBe("");
    cleanup();
    fine = true;
    reduced = true;
    tile = render(<HeroBackground />).container.querySelector<HTMLElement>(".float-tile")!;
    move(150, 128);
    expect(tile.style.translate || "").toBe("");
  });

  it("removes its listeners on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    render(<HeroBackground />).unmount();
    expect(remove.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(["pointermove", "blur"]),
    );
  });
});
