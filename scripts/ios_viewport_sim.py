"""iOS 홈 화면 앱의 뷰포트 · 키보드 동작을 흉내 내 레이아웃을 검증한다.

크롬은 iOS 처럼 "레이아웃은 그대로, 보이는 영역만 줄이는" 키보드를 재현하지 못하므로
visualViewport · innerHeight · navigator.standalone 값을 직접 흉내 낸다.

    uv run --with playwright python scripts/ios_viewport_sim.py http://127.0.0.1:8000/page "#promptInput" ".composer" ".tabbar"

인자: URL, 포커스할 입력칸, 키보드 위에 붙어야 할 요소(입력바), 바닥에 붙어야 할 요소(탭바, 선택)
가정: 불투명 상태바(black) → 앱 영역 390x785, 홈 인디케이터 34, 키보드 336
"""

import asyncio
import sys

from playwright.async_api import async_playwright

APP_H, KEYBOARD = 785, 336

MOCK = """(() => {
  const vv = new EventTarget(); const SHRINK = window.__SHRINK__;
  vv.height = %(h)d; vv.width = 390; vv.offsetTop = 0; vv.offsetLeft = 0; vv.scale = 1;
  Object.defineProperty(window, 'visualViewport', { get: () => vv });
  Object.defineProperty(window, 'innerHeight', { get: () => (SHRINK ? vv.height : %(h)d) });
  Object.defineProperty(navigator, 'standalone', { get: () => true });
  window.__keyboard = (open) => { vv.height = open ? %(h)d - %(k)d : %(h)d; vv.dispatchEvent(new Event('resize')); };
})();""" % {"h": APP_H, "k": KEYBOARD}

BOTTOM = "(sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().bottom) : null; }"


async def run(url: str, focus: str, bar: str, tabbar: str | None, shrink: bool) -> bool:
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 390, "height": APP_H}, is_mobile=True, has_touch=True
        )
        await ctx.add_init_script(
            f"window.__SHRINK__ = {'true' if shrink else 'false'};" + MOCK
        )
        page = await ctx.new_page()
        cdp = await ctx.new_cdp_session(page)
        await cdp.send(
            "Emulation.setSafeAreaInsetsOverride",
            {"insets": {"top": 0, "bottom": 34, "left": 0, "right": 0}},
        )
        await page.goto(url)
        await page.wait_for_timeout(1000)
        ok = True
        if tabbar:
            bottom = await page.evaluate(BOTTOM, tabbar)
            print(f"  탭바 아래 끝 {bottom} == {APP_H}: {bottom == APP_H}")
            ok &= bottom == APP_H
        await page.focus(focus)
        await page.evaluate("window.__keyboard(true)")
        await page.wait_for_timeout(800)
        bottom = await page.evaluate(BOTTOM, bar)
        print(
            f"  키보드: 입력바 아래 끝 {bottom} == 키보드 위 {APP_H - KEYBOARD}: {bottom == APP_H - KEYBOARD}"
        )
        ok &= bottom == APP_H - KEYBOARD
        await page.evaluate("document.activeElement.blur(); window.__keyboard(false)")
        await page.wait_for_timeout(800)
        bottom = await page.evaluate(BOTTOM, bar)
        print(f"  키보드 닫힘: 입력바 아래 끝 {bottom} (원래대로?)")
        await browser.close()
        return ok


async def main() -> None:
    url, focus, bar = sys.argv[1:4]
    tabbar = sys.argv[4] if len(sys.argv) > 4 else None
    results = []
    for shrink in (True, False):
        print(f"== 키보드 때 innerHeight 도 줄어듦: {shrink}")
        results.append(await run(url, focus, bar, tabbar, shrink))
    print("\n통과 ✓" if all(results) else "\n실패 ✗")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    asyncio.run(main())
